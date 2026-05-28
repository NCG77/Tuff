from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import uvicorn
from ai_insights import explain_finding
from aws_engine import AWSEngine
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TUFF Backend API",
    description="Cloud Infrastructure Analysis Engine",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_credentials=True,
    allow_headers=["*"],
)

class ScanRequest(BaseModel):
    aws_access_key: str
    aws_secret_key: str
    region: str = "us-east-1"  

class ExecuteRequest(BaseModel):
    aws_access_key: str
    aws_secret_key: str
    region: str = "us-east-1"  
    resource_id: str
    action_type: str

@app.post("/api/execute")
async def execute_remediation(request: ExecuteRequest):
    """
    Receives an approval command from the frontend and uses boto3 
    to physically modify or remediate the target cloud resource.
    """
    try:
        logger.info(f"⚡ Received execution command: {request.action_type} for resource {request.resource_id}")

        # SIMULATION INTERCEPT TRIGGER
        if "demo" in request.resource_id.lower() or "production" in request.resource_id.lower():
            logger.info(f"ℹ️ Simulation Mode: Successfully executed action '{request.action_type}' on mock resource {request.resource_id}")
            return JSONResponse(content={
                "status": "success", 
                "message": f"Simulated mitigation '{request.action_type}' applied successfully. Cloud environment optimized."
            })

        # LIVE BOTO3 EXECUTION ENGINE
        aws_engine = AWSEngine(
            aws_access_key=request.aws_access_key,
            aws_secret_key=request.aws_secret_key,
            region_name=request.region
        )
        
        # Initialize standard boto3 session clients
        session = aws_engine.session

        if request.action_type == "stop_instance":
            ec2 = session.client('ec2')
            # InstanceIds strictly requires a Python list [] of strings
            ec2.stop_instances(InstanceIds=[str(request.resource_id)])
            msg = f"Successfully stopped zombie EC2 instance {request.resource_id}."

        elif request.action_type == "delete_volume":
            ec2 = session.client('ec2')
            # FIX COMPLETE: VolumeId strictly requires a single flat string, not a list
            ec2.delete_volume(VolumeId=str(request.resource_id))
            msg = f"Successfully purged unattached EBS volume {request.resource_id}."

        elif request.action_type == "secure_s3":
            s3 = session.client('s3')
            s3.put_public_access_block(
                Bucket=str(request.resource_id),
                PublicAccessBlockConfiguration={
                    'BlockPublicAcls': True,
                    'IgnorePublicAcls': True,
                    'BlockPublicPolicy': True,
                    'RestrictPublicBuckets': True
                }
            )
            msg = f"Successfully enabled Public Access Block on vulnerable S3 bucket {request.resource_id}."
        
        else:
            raise HTTPException(status_code=400, detail=f"Unrecognized action type: {request.action_type}")

        logger.info(f"✅ Live execution successful: {msg}")
        return JSONResponse(content={"status": "success", "message": msg})

    except Exception as e:
        logger.error(f"❌ Execution failed on resource {request.resource_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Remediation pipeline crashed: {str(e)}")


@app.post("/api/analyze")
async def analyze_infrastructure(request: ScanRequest):
    try:
        logger.info(f"🚀 Initializing cloud audit for region: {request.region}")
        
        # SIMULATION INTERCEPT TRIGGER
        # If the key provided is a demo string, use simulated infrastructure data
        if request.aws_access_key.lower() in ["demo", "mock", "test"]:
            logger.info("ℹ️ AWS Credentials set to demo mode. Generating simulated infrastructure footprint...")
            raw_findings = [
                {
                    "resource_type": "EC2",
                    "resource_id": "i-0987654321demo",
                    "issue": "Idle Instance",
                    "severity": "medium",
                    "metrics": {
                        "cpu_avg": 1.8,
                        "max_cpu_observed": 3.1,
                        "instance_type": "m5.2xlarge"
                    },
                    "region": request.region,
                    "estimated_monthly_cost": 288
                },
                {
                    "resource_type": "EBS_Volume",
                    "resource_id": "vol-0abc1234demovol",
                    "issue": "Unattached Volume",
                    "severity": "high",
                    "metrics": {
                        "size_gb": 1000,
                        "volume_type": "gp3"
                    },
                    "region": request.region,
                    "estimated_monthly_cost": 80
                },
                {
                    "resource_type": "S3_Bucket",
                    "resource_id": "tuff-production-sensitive-data",
                    "issue": "Public Access Block Disabled",
                    "severity": "critical",
                    "metrics": {
                        "public_sharing_risk": "High"
                    },
                    "region": "global"
                }
            ]
        else:
            # Run the live multi-layered cloud scan if real keys are provided
            aws_engine = AWSEngine(
                aws_access_key=request.aws_access_key,
                aws_secret_key=request.aws_secret_key,
                region_name=request.region
            )
            raw_findings = aws_engine.execute_full_scan()
        
        logger.info(f"📊 Pipeline data ready. Processing {len(raw_findings)} items via Groq Engine...")

        ai_evaluated_queue = []

        # Stream datasets through your optimized live Llama-3.3 model file configuration
        for finding in raw_findings:
            ai_analysis = explain_finding(finding)
            
            completed_payload = {
                "id": finding["resource_id"],
                "type": f"{finding['issue']} ({finding['resource_type']})",
                "inst": finding["metrics"].get("instance_type", finding["resource_type"]),
                "cpu": f"{finding['metrics'].get('cpu_avg', '0')}%",
                "region": finding["region"],
                "cur": f"${finding.get('estimated_monthly_cost', '120')}/mo",
                "save": f"${ai_analysis.get('estimated_savings', 'TBD')}/mo",
                "explanation": ai_analysis.get("explanation", "Manual review recommended."),
                "business_impact": ai_analysis.get("business_impact", "Unknown risk profile."),
                "recommended_action": ai_analysis.get("recommended_action", "Investigate resource configuration."),
                "priority": ai_analysis.get("priority", "medium")
            }
            ai_evaluated_queue.append(completed_payload)

        return JSONResponse(content={"status": "success", "data": ai_evaluated_queue})

    except Exception as e:
        logger.error(f"❌ Core infrastructure analysis loop failed: {str(e)}")
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