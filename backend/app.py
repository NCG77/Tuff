from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import uvicorn
import os
from dotenv import load_dotenv
from ai_insights import explain_finding, session_tracker
from aws_engine import AWSEngine
from pydantic import BaseModel
from datetime import datetime
import uuid
from db import init_db, get_db, AlertConfig, TriggeredAlert, InfrastructureLog, ExecutionLog, ActionLog, UserSubscription
from sqlalchemy.orm import Session

load_dotenv()

def format_datetime(dt: datetime) -> str:
    """Format datetime to ISO format with timezone info"""
    return dt.isoformat() if isinstance(dt, datetime) else str(dt)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TUFF Backend API",
    description="Cloud Infrastructure Analysis Engine with Tiered AI Processing",
    version="1.0.0"
)

frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
environment = os.getenv("ENVIRONMENT", "development")

cors_origins = [frontend_url] if environment == "production" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_credentials=True,
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    init_db()
    logger.info("✅ Supabase Database initialized successfully")

class UserSyncRequest(BaseModel):
    firebase_uid: str

class ScanRequest(BaseModel):
    aws_access_key: str
    aws_secret_key: str
    region: str = "us-east-1"  
    user_id: str 

class ExecuteRequest(BaseModel):
    aws_access_key: str
    aws_secret_key: str
    region: str = "us-east-1"  
    resource_id: str
    action_type: str
    user_id: str = "unknown"

class AlertConfigRequest(BaseModel):
    resourceType: str
    metric: str
    threshold: float
    thresholdType: str
    user_id: str

class AlertRequest(BaseModel):
    findings: list
    alertConfigs: list
    user_id: str

@app.post("/api/user/sync")
async def sync_user_tier(request: UserSyncRequest, db: Session = Depends(get_db)):
    """
    Called by the frontend immediately after a successful Firebase login.
    Checks if the user exists in Supabase. If not, provisions a free-tier profile.
    """
    try:
        user_record = db.query(UserSubscription).filter(UserSubscription.user_id == request.firebase_uid).first()
        
        if not user_record:
            user_record = UserSubscription(
                user_id=request.firebase_uid, 
                subscription_tier="free"
            )
            db.add(user_record)
            db.commit()
            db.refresh(user_record)
            logger.info(f"✅ Provisioned new user profile in Supabase: {request.firebase_uid}")
            
        return JSONResponse(content={
            "status": "synchronized", 
            "tier": user_record.subscription_tier,
            "user_id": user_record.user_id
        })
        
    except Exception as e:
        logger.error(f"❌ Failed to synchronize user profile: {str(e)}")
        raise HTTPException(status_code=500, detail="Database synchronization failure.")


@app.post("/api/analyze")
async def analyze_infrastructure(request: ScanRequest, db: Session = Depends(get_db)):
    scan_id = str(uuid.uuid4())
    
    try:
        user_record = db.query(UserSubscription).filter(UserSubscription.user_id == request.user_id).first()
        user_tier = user_record.subscription_tier.lower().strip() if user_record else "free"
        session_tracker.configure_session_tier(user_tier)
        
        logger.info(f"Initializing cloud audit for region: {request.region} (Scan ID: {scan_id}) [Verified Tier: {user_tier.upper()}]")
        
        aws_engine = AWSEngine(
            aws_access_key=request.aws_access_key,
            aws_secret_key=request.aws_secret_key,
            region_name=request.region
        )
        raw_findings = aws_engine.execute_full_scan()
        logger.info(f"Pipeline data ready. Processing {len(raw_findings)} items via AI analysis under '{user_tier}' quota...")

        ai_evaluated_queue = []
        minimal_findings = [] 

        for finding in raw_findings:
            ai_analysis = explain_finding(finding)
            
            completed_payload = {
                "id": finding["resource_id"],
                "type": f"{finding['issue']} ({finding['resource_type']})",
                "inst": finding["metrics"].get("instance_type", finding["resource_type"]),
                "cpu": f"{finding['metrics'].get('cpu_avg', '0')}%",
                "region": finding.get("region", request.region), 
                "cur": f"${finding.get('estimated_monthly_cost', '120')}/mo",
                "save": f"${ai_analysis.get('estimated_savings', 'TBD')}/mo",
                "explanation": ai_analysis.get("explanation", "Manual review recommended."),
                "business_impact": ai_analysis.get("business_impact", "Unknown risk profile."),
                "recommended_action": ai_analysis.get("recommended_action", "Investigate resource configuration."),
                "priority": ai_analysis.get("priority", "medium")
            }
            ai_evaluated_queue.append(completed_payload)
            minimal_findings.append({
                "id": finding["resource_id"],
                "res_type": finding["resource_type"],
                "issue": finding["issue"],
                "severity": finding["severity"],
                "cost": finding.get("estimated_monthly_cost", 0),
                "save": ai_analysis.get("estimated_savings", 0)
            })

        infra_log = InfrastructureLog(
            scan_id=scan_id,
            region=request.region,
            findings=minimal_findings,
            findings_count=len(minimal_findings),
            status="completed"
        )
        db.add(infra_log)
        db.commit()
        
        logger.info(f"✅ Infrastructure scan logged to database (Scan ID: {scan_id})")
        return JSONResponse(content={
            "status": "success",
            "data": ai_evaluated_queue,
            "scan_id": scan_id,
            "timestamp": format_datetime(datetime.utcnow()),
            "findings_count": len(minimal_findings),
            "tier_applied": user_tier
        })

    except RuntimeError as e:
        error_message = str(e)
        logger.error(f"❌ AI Quota/Execution Error: {error_message}")
        try:
            infra_log = InfrastructureLog(
                scan_id=scan_id,
                region=request.region,
                findings=[],
                findings_count=0,
                status="failed",
                error_message=error_message
            )
            db.add(infra_log)
            db.commit()
        except Exception as db_err:
            logger.error(f"Failed to save error state to DB: {str(db_err)}")
    
        if "ERROR_SESSION_LIMIT_EXCEEDED" in error_message:
            raise HTTPException(status_code=429, detail="TIER_TOKEN_LIMIT_EXCEEDED")
        elif "ERROR_QUOTA_EXCEEDED" in error_message:
            raise HTTPException(status_code=429, detail="AI_TOKEN_LIMIT_REACHED")
        elif "ERROR_INSUFFICIENT_FUNDS" in error_message:
            raise HTTPException(status_code=402, detail="AI_BILLING_LIMIT_REACHED")
        else:
            raise HTTPException(status_code=502, detail="AI_PROVIDER_ERROR")

    except Exception as e:
        logger.error(f"❌ Core infrastructure analysis loop failed: {str(e)}")
        
        try:
            infra_log = InfrastructureLog(
                scan_id=scan_id,
                region=request.region,
                findings=[],
                findings_count=0,
                status="failed",
                error_message=str(e)
            )
            db.add(infra_log)
            db.commit()
        except Exception as db_err:
            logger.error(f"Failed to save generic error state to DB: {str(db_err)}")
            
        raise HTTPException(status_code=500, detail=f"Infrastructure scan failed: {str(e)}")


@app.post("/api/execute")
async def execute_remediation(request: ExecuteRequest, db: Session = Depends(get_db)):
    try:
        logger.info(f"⚡ Received execution command: {request.action_type} for resource {request.resource_id}")
        aws_engine = AWSEngine(
            aws_access_key=request.aws_access_key,
            aws_secret_key=request.aws_secret_key,
            region_name=request.region
        )
        
        session = aws_engine.session

        if request.action_type == "stop_instance":
            ec2 = session.client('ec2')
            ec2.stop_instances(InstanceIds=[str(request.resource_id)])
            msg = f"Successfully stopped zombie EC2 instance {request.resource_id}."

        elif request.action_type == "delete_volume":
            ec2 = session.client('ec2')
            ec2.delete_volume(VolumeId=request.resource_id)
            msg = f"Successfully purged unattached EBS volume {request.resource_id}."
        
        elif request.action_type =="delete_vpc":
            ec2=session.client('ec2')
            ec2.delete_vpc(VpcId=str(request.resource_id))
            msg= f"Successfully deleted misconfigured VPC {request.resource_id}."
        
        elif request.action_type == "delete_rds":
            rds = session.client('rds')
            rds.delete_db_instance(DBInstanceIdentifier=str(request.resource_id), SkipFinalSnapshot=True)
            msg = f"Successfully deleted underutilized RDS instance {request.resource_id}."

        elif request.action_type == "secure_s3":
            s3 = session.client('s3')
            s3.put_public_access_block(
                Bucket=request.resource_id,
                PublicAccessBlockConfiguration={
                    'BlockPublicAcls': True,
                    'IgnorePublicAcls': True,
                    'BlockPublicPolicy': True,
                    'RestrictPublicBuckets': True
                }
            )
            msg = f"Successfully enabled Public Access Block on vulnerable S3 bucket {request.resource_id}."
            
        elif request.action_type == "scale_instance":
            ec2 = session.client('ec2')
            instance_id = str(request.resource_id)
            print(f"Stopping instance {instance_id} for rightsizing...")
            ec2.stop_instances(InstanceIds=[instance_id])
            waiter = ec2.get_waiter('instance_stopped')
            waiter.wait(InstanceIds=[instance_id])
            target_type = getattr(request, 'target_type', 't3.micro')
            ec2.modify_instance_attribute(
                InstanceId=instance_id, 
                InstanceType={'Value': target_type}
            )
            ec2.start_instances(InstanceIds=[instance_id])
            msg = f"Successfully scaled instance {instance_id} down to {target_type} dynamically."
        
        else:
            raise HTTPException(status_code=400, detail=f"Unrecognized action type: {request.action_type}")

        logger.info(f"✅ Live execution successful: {msg}")
        
        exec_log = ExecutionLog(
            user_id=request.user_id,
            resource_id=request.resource_id,
            action_type=request.action_type,
            result={"status": "success", "message": msg, "timestamp": format_datetime(datetime.utcnow())},
            execution_status="success"
        )
        db.add(exec_log)
        db.commit()
        
        return JSONResponse(content={
            "status": "success",
            "message": msg,
            "timestamp": format_datetime(datetime.utcnow()),
            "execution_id": exec_log.id
        })

    except Exception as e:
        logger.error(f"❌ Execution failed on resource {request.resource_id}: {str(e)}")
        
        exec_log = ExecutionLog(
            user_id=request.user_id,
            resource_id=request.resource_id,
            action_type=request.action_type,
            result={"status": "failed", "error": str(e), "timestamp": format_datetime(datetime.utcnow())},
            execution_status="failed"
        )
        db.add(exec_log)
        db.commit()
        
        raise HTTPException(status_code=500, detail=f"Remediation pipeline crashed: {str(e)}")


@app.get("/api/logs/infrastructure")
async def get_infrastructure_logs(limit: int = 50, db: Session = Depends(get_db)):
    try:
        logs = db.query(InfrastructureLog).order_by(InfrastructureLog.timestamp.desc()).limit(limit).all()
        return JSONResponse(content={
            "status": "success",
            "logs": [
                {
                    "scan_id": log.scan_id,
                    "region": log.region,
                    "findings_count": log.findings_count,
                    "status": log.status,
                    "timestamp": format_datetime(log.timestamp),
                    "error": log.error_message
                }
                for log in logs
            ]
        })
    except Exception as e:
        logger.error(f"❌ Failed to retrieve infrastructure logs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/logs/infrastructure/{scan_id}")
async def get_scan_details(scan_id: str, db: Session = Depends(get_db)):
    try:
        log = db.query(InfrastructureLog).filter(InfrastructureLog.scan_id == scan_id).first()
        if not log:
            raise HTTPException(status_code=404, detail=f"Scan {scan_id} not found")
        
        return JSONResponse(content={
            "status": "success",
            "scan": {
                "scan_id": log.scan_id,
                "region": log.region,
                "findings_count": log.findings_count,
                "findings": log.findings,
                "status": log.status,
                "timestamp": format_datetime(log.timestamp)
            }
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to retrieve scan details: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/logs/execution")
async def get_execution_logs(limit: int = 50, db: Session = Depends(get_db)):
    try:
        logs = db.query(ExecutionLog).order_by(ExecutionLog.timestamp.desc()).limit(limit).all()
        return JSONResponse(content={
            "status": "success",
            "logs": [
                {
                    "id": log.id,
                    "resource_id": log.resource_id,
                    "action_type": log.action_type,
                    "status": log.execution_status,
                    "result": log.result,
                    "timestamp": format_datetime(log.timestamp)
                }
                for log in logs
            ]
        })
    except Exception as e:
        logger.error(f"❌ Failed to retrieve execution logs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-iam-policy")
async def generate_iam_policy():
    from ai_insights import client
    import json
    
    try:
        logger.info("Generating AI-powered IAM policy...")
        
        prompt = """Generate a comprehensive AWS IAM policy JSON for a cloud optimization tool called TUFF that:
        1. Scans EC2 instances, EBS volumes, RDS databases, S3 buckets, and VPCs
        2. Can stop/start EC2 instances
        3. Can delete unattached EBS volumes
        4. Can delete RDS instances
        5. Can secure S3 buckets with Public Access Block
        6. Can delete VPCs
        7. Can modify instance types
        8. Can read CloudWatch metrics
        
        Respond ONLY with valid JSON in this exact format:
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "EC2Operations",
                    "Effect": "Allow",
                    "Action": ["action1", "action2"],
                    "Resource": "*"
                }
            ]
        }
        
        Include all necessary actions for scanning and remediating cloud resources. Be comprehensive."""
        
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are an AWS IAM security expert. You must respond exclusively with valid JSON policy documents. Only output JSON, nothing else."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            response_format={"type": "json_object"},
            temperature=0.1
        )
        
        response_text = response.choices[0].message.content
        policy = json.loads(response_text)
        
        logger.info("IAM policy generated successfully")
        return JSONResponse(content={
            "status": "success",
            "policy": policy,
            "timestamp": format_datetime(datetime.utcnow()),
            "description": "Minimum required IAM permissions for TUFF operations"
        })
        
    except Exception as e:
        logger.error(f"Failed to generate IAM policy: {str(e)}")
        fallback_policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "EC2FullAccess",
                    "Effect": "Allow",
                    "Action": ["ec2:*"],
                    "Resource": "*"
                },
                {
                    "Sid": "RDSFullAccess",
                    "Effect": "Allow",
                    "Action": ["rds:*"],
                    "Resource": "*"
                },
                {
                    "Sid": "S3FullAccess",
                    "Effect": "Allow",
                    "Action": ["s3:*"],
                    "Resource": "*"
                },
                {
                    "Sid": "CloudWatchMetrics",
                    "Effect": "Allow",
                    "Action": ["cloudwatch:GetMetricStatistics", "cloudwatch:ListMetrics"],
                    "Resource": "*"
                }
            ]
        }
        return JSONResponse(content={
            "status": "success",
            "policy": fallback_policy,
            "timestamp": format_datetime(datetime.utcnow()),
            "description": "Fallback IAM permissions for TUFF operations",
            "note": "Full permissions recommended. Customize as needed based on your security requirements."
        })

@app.post("/api/alerts/config")
async def create_alert_config(request: AlertConfigRequest, db: Session = Depends(get_db)):
    try:
        config_id = str(uuid.uuid4())
        alert_config = AlertConfig(
            id=config_id,
            user_id=request.user_id,
            resource_type=request.resourceType,
            metric=request.metric,
            threshold=request.threshold,
            threshold_type=request.thresholdType,
            active=True
        )
        db.add(alert_config)
        db.commit()
        db.refresh(alert_config)
        logger.info(f"✅ Alert config created for user {request.user_id}: {config_id}")
        return JSONResponse(content={
            "status": "success",
            "alert": {
                "id": alert_config.id,
                "resourceType": alert_config.resource_type,
                "metric": alert_config.metric,
                "threshold": alert_config.threshold,
                "thresholdType": alert_config.threshold_type,
                "created_at": format_datetime(alert_config.created_at)
            }
        })
    except Exception as e:
        logger.error(f"❌ Failed to create alert config: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/alerts/config")
async def get_alert_configs(user_id: str, db: Session = Depends(get_db)):
    try:
        configs = db.query(AlertConfig).filter(
            AlertConfig.active == True,
            AlertConfig.user_id == user_id
        ).all()
        return JSONResponse(content={
            "status": "success",
            "configs": [
                {
                    "id": c.id,
                    "resourceType": c.resource_type,
                    "metric": c.metric,
                    "threshold": c.threshold,
                    "thresholdType": c.threshold_type,
                    "created_at": format_datetime(c.created_at)
                }
                for c in configs
            ]
        })
    except Exception as e:
        logger.error(f"❌ Failed to retrieve alert configs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/alerts/config/{config_id}")
async def delete_alert_config(config_id: str, db: Session = Depends(get_db)):
    try:
        config = db.query(AlertConfig).filter(AlertConfig.id == config_id).first()
        if not config:
            raise HTTPException(status_code=404, detail=f"Alert config {config_id} not found")
        
        config.active = False 
        db.commit()
        logger.info(f"✅ Alert config deleted: {config_id}")
        return JSONResponse(content={"status": "success", "message": f"Alert config {config_id} deleted"})
    except Exception as e:
        logger.error(f"❌ Failed to delete alert config: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class ActionLogRequest(BaseModel):
    user_id: str
    resource_id: str
    action: str
    resource_type: str

@app.post("/api/action-logs")
async def save_action_log(request: ActionLogRequest, db: Session = Depends(get_db)):
    try:
        log_id = str(uuid.uuid4())
        action_log = ActionLog(
            id=log_id,
            user_id=request.user_id,
            resource_id=request.resource_id,
            action=request.action,
            resource_type=request.resource_type
        )
        db.add(action_log)
        db.commit()
        logger.info(f"✅ Action log saved for user {request.user_id}: {log_id}")
        return JSONResponse(content={
            "status": "success",
            "log_id": log_id,
            "timestamp": format_datetime(datetime.utcnow())
        })
    except Exception as e:
        logger.error(f"❌ Failed to save action log: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/action-logs")
async def get_action_logs(user_id: str, limit: int = 100, db: Session = Depends(get_db)):
    try:
        logs = db.query(ActionLog).filter(
            ActionLog.user_id == user_id
        ).order_by(ActionLog.timestamp.desc()).limit(limit).all()
        
        return JSONResponse(content={
            "status": "success",
            "logs": [
                {
                    "id": log.id,
                    "resource_id": log.resource_id,
                    "action": log.action,
                    "type": log.resource_type,
                    "timestamp": format_datetime(log.timestamp)
                }
                for log in logs
            ]
        })
    except Exception as e:
        logger.error(f"❌ Failed to retrieve action logs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/alerts/triggered")
async def get_triggered_alerts(user_id: str, limit: int = 100, db: Session = Depends(get_db)):
    try:
        alerts = db.query(TriggeredAlert).filter(
            TriggeredAlert.user_id == user_id
        ).order_by(TriggeredAlert.timestamp.desc()).limit(limit).all()
        
        return JSONResponse(content={
            "status": "success",
            "alerts": [
                {
                    "id": alert.id,
                    "configId": alert.config_id,
                    "resourceId": alert.resource_id,
                    "resourceType": alert.resource_type,
                    "metric": alert.metric,
                    "value": alert.value,
                    "threshold": alert.threshold,
                    "condition": alert.condition,
                    "timestamp": format_datetime(alert.timestamp)
                }
                for alert in alerts
            ]
        })
    except Exception as e:
        logger.error(f"❌ Failed to retrieve triggered alerts: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/alerts/evaluate")
async def evaluate_alerts(request: AlertRequest, db: Session = Depends(get_db)):
    try:
        triggered_alerts = []
        
        for config in request.alertConfigs:
            for finding in request.findings:
                metric_value = 0
                
                if config["metric"].lower() == "cpu":
                    metric_value = float(finding.get("cpu", "0").replace("%", "")) if finding.get("cpu") else 0
                elif config["metric"].lower() == "save":
                    metric_value = float(finding.get("save", "0").replace("$", "").replace("/mo", "")) if finding.get("save") else 0
                elif config["metric"].lower() == "cur":
                    metric_value = float(finding.get("cur", "0").replace("$", "").replace("/mo", "")) if finding.get("cur") else 0
                
                triggered = False
                if config["thresholdType"] == "below":
                    triggered = metric_value < config["threshold"]
                elif config["thresholdType"] == "above":
                    triggered = metric_value > config["threshold"]
                
                if triggered and config["resourceType"] in finding.get("type", ""):
                    alert_record = TriggeredAlert(
                        user_id=request.user_id,
                        config_id=config.get("id"),
                        resource_id=finding.get("id"),
                        resource_type=finding.get("type"),
                        metric=config["metric"],
                        value=metric_value,
                        threshold=config["threshold"],
                        condition=config["thresholdType"]
                    )
                    db.add(alert_record)
                    triggered_alerts.append({
                        "config_id": config.get("id"),
                        "resource_id": finding.get("id"),
                        "resource_type": finding.get("type"),
                        "metric": config["metric"],
                        "value": metric_value,
                        "threshold": config["threshold"],
                        "condition": config["thresholdType"],
                        "timestamp": format_datetime(datetime.utcnow())
                    })
        
        db.commit()
        logger.info(f"Alert evaluation complete for user {request.user_id}: {len(triggered_alerts)} alerts triggered")
        return JSONResponse(content={"status": "success", "alerts": triggered_alerts})
    except Exception as e:
        logger.error(f"Failed to evaluate alerts: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "TUFF Backend",
        "version": "1.0.0"
    }

@app.get("/")
async def root():
    return {
        "message": "TUFF Backend API",
        "docs": "/docs",
        "health": "/api/health",
        "main_endpoint": "/api/analyze"
    }

if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )