#!/usr/bin/env python3
"""Tuff Model Context Protocol (MCP) Server.

Exposes Tuff's Cloud Infrastructure Analysis Engine (cost optimization,
security auditing, AWS resource scanning, and remediation) to external AI
clients such as Claude Desktop, Cursor, Antigravity, and other MCP-compliant agents.
"""

import argparse
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Ensure backend directory is in Python path
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from dotenv import load_dotenv

load_dotenv(os.path.join(_HERE, ".env.local"))
load_dotenv(os.path.join(_HERE, ".env"))

from mcp.server.mcpserver import MCPServer

from aws_engine import AWSEngine
import ai_insights
from db import (
    ActionLog,
    ExecutionLog,
    InfrastructureLog,
    SessionLocal,
    utcnow,
)

logger = logging.getLogger("tuff.mcp")

# Initialize MCP Server
mcp = MCPServer("tuff")


def _resolve_aws_engine(
    region: str = "us-east-1",
    aws_access_key: str = "",
    aws_secret_key: str = "",
) -> AWSEngine:
    """Resolve an AWSEngine instance using explicit parameters, environment variables, or ambient credentials.

    Resolution order:
    - Access Key: explicit `aws_access_key` -> `AWS_ACCESS_KEY_ID` -> None (boto3 ambient / IAM role).
    - Secret Key: explicit `aws_secret_key` -> `AWS_SECRET_ACCESS_KEY` -> None (boto3 ambient / IAM role).
    - Region: explicit `region` -> `AWS_REGION` -> `AWS_DEFAULT_REGION` -> "us-east-1".

    Args:
        region: AWS region string. Defaults to "us-east-1".
        aws_access_key: AWS access key ID. Empty string triggers environment/ambient resolution.
        aws_secret_key: AWS secret access key. Empty string triggers environment/ambient resolution.

    Returns:
        Configured AWSEngine instance.
    """
    access_key = aws_access_key.strip() or os.getenv("AWS_ACCESS_KEY_ID", "").strip() or None
    secret_key = aws_secret_key.strip() or os.getenv("AWS_SECRET_ACCESS_KEY", "").strip() or None
    target_region = (
        region.strip()
        or os.getenv("AWS_REGION", "").strip()
        or os.getenv("AWS_DEFAULT_REGION", "").strip()
        or "us-east-1"
    )
    return AWSEngine(
        aws_access_key=access_key,
        aws_secret_key=secret_key,
        region_name=target_region,
    )


# ---------------------------------------------------------------------------
# MCP Tools
# ---------------------------------------------------------------------------


@mcp.tool()
def tuff_audit_aws(
    region: str = "us-east-1",
    services: str = "all",
    include_global: bool = True,
    explain_with_ai: bool = False,
    aws_access_key: str = "",
    aws_secret_key: str = "",
) -> Dict[str, Any]:
    """Perform a comprehensive cost and security audit on an AWS account.

    Audits resources across supported AWS services, deduplicates findings, calculates
    projected monthly and annual cost savings, and optionally persists results to the database.

    Args:
        region: AWS region to audit (e.g., 'us-east-1', 'eu-west-1', 'ap-south-1').
        services: Service scope to audit: 'all', 'ec2', 'ebs', 's3', 'rds', 'vpc'.
        include_global: When True and service scope includes 'all' or 's3', inspects global resources (S3 buckets).
        explain_with_ai: When True and AI credentials are configured, enriches high/critical findings with AI root-cause analysis.
        aws_access_key: Optional AWS Access Key ID (falls back to AWS_ACCESS_KEY_ID env var / ambient credentials).
        aws_secret_key: Optional AWS Secret Access Key (falls back to AWS_SECRET_ACCESS_KEY env var / ambient credentials).

    Returns:
        Dict[str, Any]: On success:
            - scan_id (str): UUID identifying the audit record.
            - region (str): Evaluated AWS region.
            - total_findings (int): Count of unique identified issues.
            - estimated_monthly_savings_usd (float): Aggregate estimated monthly savings in USD.
            - estimated_annual_savings_usd (float): Projected 12-month savings in USD.
            - severity_counts (Dict[str, int]): Map of severity tiers ('critical', 'high', 'medium', 'low') to counts.
            - findings (List[Dict[str, Any]]): Detailed finding records containing resource_id, issue,
              severity, estimated_monthly_savings, recommendation, and action_type.
        On failure:
            - error (str): Error message detailing failure cause.
            - region (str): AWS region targeted by the failed scan.
            - status (str): "failed".
    """
    try:
        engine = _resolve_aws_engine(region, aws_access_key, aws_secret_key)
        findings: List[Dict[str, Any]] = []
        svc = services.strip().lower()

        if svc in ("all", "ec2"):
            try:
                findings.extend(engine.scan_zombie_ec2())
                findings.extend(engine.scan_stopped_ec2())
                findings.extend(engine.scan_scaling_candidates())
            except Exception as e:
                logger.warning("EC2 scan error: %s", e)

        if svc in ("all", "ebs"):
            try:
                findings.extend(engine.scan_zombie_ebs())
            except Exception as e:
                logger.warning("EBS scan error: %s", e)

        if svc in ("all", "s3") and include_global:
            try:
                findings.extend(engine.scan_public_s3())
            except Exception as e:
                logger.warning("S3 scan error: %s", e)

        if svc in ("all", "rds"):
            try:
                findings.extend(engine.scan_rds())
            except Exception as e:
                logger.warning("RDS scan error: %s", e)

        if svc in ("all", "vpc"):
            try:
                findings.extend(engine.scan_vpc())
            except Exception as e:
                logger.warning("VPC scan error: %s", e)

        # Deduplicate findings
        unique_findings: List[Dict[str, Any]] = []
        seen_keys = set()
        for f in findings:
            key = (f.get("resource_id"), f.get("issue"))
            if key not in seen_keys:
                seen_keys.add(key)
                unique_findings.append(f)

        # Compute summary metrics
        total_monthly_savings = sum(
            float(f.get("estimated_monthly_savings") or 0.0) for f in unique_findings
        )
        severity_breakdown = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for f in unique_findings:
            sev = (f.get("severity") or "low").lower()
            if sev in severity_breakdown:
                severity_breakdown[sev] += 1
            else:
                severity_breakdown[sev] = 1

        # Optionally enrich with AI explanations
        if explain_with_ai and ai_insights.ai_configured():
            for f in unique_findings:
                if f.get("severity") in ("critical", "high"):
                    try:
                        exp, _ = ai_insights.explain_finding(f)
                        f["ai_explanation"] = exp
                    except Exception as ai_err:
                        logger.warning("AI explanation failed for %s: %s", f.get("resource_id"), ai_err)

        # Persist audit log in DB if available
        scan_id = str(uuid.uuid4())
        try:
            db = SessionLocal()
            try:
                log_entry = InfrastructureLog(
                    scan_id=scan_id,
                    user_id="mcp_user",
                    region=region,
                    findings=unique_findings,
                    findings_count=len(unique_findings),
                    status="completed",
                )
                db.add(log_entry)
                db.commit()
            finally:
                db.close()
        except Exception as db_err:
            logger.debug("Database record skipped: %s", db_err)

        return {
            "scan_id": scan_id,
            "region": region,
            "total_findings": len(unique_findings),
            "estimated_monthly_savings_usd": round(total_monthly_savings, 2),
            "estimated_annual_savings_usd": round(total_monthly_savings * 12, 2),
            "severity_counts": severity_breakdown,
            "findings": unique_findings,
        }

    except Exception as exc:
        logger.error("Audit failed: %s", exc, exc_info=True)
        return {
            "error": str(exc),
            "region": region,
            "status": "failed",
        }


@mcp.tool()
def tuff_get_cost_waste_report(
    region: str = "us-east-1",
    aws_access_key: str = "",
    aws_secret_key: str = "",
) -> Dict[str, Any]:
    """Generate a FinOps report pinpointing idle or oversized AWS resources wasting money.

    Scans for:
    - Idle running EC2 instances (CPU < 5%, minimal network I/O)
    - Stopped EC2 instances incurring persistent EBS volume charges
    - Unattached / abandoned EBS volumes
    - Idle RDS database instances (zero active connections)
    - Over-provisioned EC2 instances eligible for downsizing

    Args:
        region: AWS region to evaluate (e.g., 'us-east-1', 'eu-west-1'). Defaults to 'us-east-1'.
        aws_access_key: Optional AWS Access Key ID (falls back to AWS_ACCESS_KEY_ID env var / ambient credentials).
        aws_secret_key: Optional AWS Secret Access Key (falls back to AWS_SECRET_ACCESS_KEY env var / ambient credentials).

    Returns:
        Dict[str, Any]: Cost waste breakdown including:
            - region (str): Evaluated AWS region.
            - total_wasteful_resources (int): Count of resources generating idle spend.
            - total_monthly_waste_usd (float): Sum of monthly wasted dollars across all categories.
            - total_annual_waste_usd (float): Projected annual cost waste in USD.
            - categories (Dict[str, Dict[str, Any]]): Breakdown by resource type with item counts, monthly savings,
              and remediation metadata.
            - top_waste_opportunities (List[Dict[str, Any]]): Top 10 cost reduction items sorted by monthly savings.
        Returns error dictionary if the underlying audit fails.
    """
    audit = tuff_audit_aws(
        region=region,
        services="all",
        include_global=False,
        explain_with_ai=False,
        aws_access_key=aws_access_key,
        aws_secret_key=aws_secret_key,
    )

    if "error" in audit:
        return audit

    cost_findings = [
        f for f in audit.get("findings", [])
        if float(f.get("estimated_monthly_savings") or 0.0) > 0
    ]

    # Sort opportunities by highest dollar savings first
    cost_findings.sort(
        key=lambda x: float(x.get("estimated_monthly_savings") or 0.0),
        reverse=True,
    )

    by_type: Dict[str, Dict[str, Any]] = {}
    for f in cost_findings:
        rtype = f.get("resource_type", "unknown")
        if rtype not in by_type:
            by_type[rtype] = {"count": 0, "monthly_savings": 0.0, "items": []}
        savings = float(f.get("estimated_monthly_savings") or 0.0)
        by_type[rtype]["count"] += 1
        by_type[rtype]["monthly_savings"] = round(by_type[rtype]["monthly_savings"] + savings, 2)
        by_type[rtype]["items"].append({
            "resource_id": f.get("resource_id"),
            "issue": f.get("issue"),
            "monthly_savings_usd": savings,
            "recommendation": f.get("recommendation"),
            "action_type": f.get("action_type"),
        })

    total_monthly = round(sum(cat["monthly_savings"] for cat in by_type.values()), 2)

    return {
        "region": region,
        "total_wasteful_resources": len(cost_findings),
        "total_monthly_waste_usd": total_monthly,
        "total_annual_waste_usd": round(total_monthly * 12, 2),
        "categories": by_type,
        "top_waste_opportunities": cost_findings[:10],
    }


@mcp.tool()
def tuff_get_security_risks(
    region: str = "us-east-1",
    aws_access_key: str = "",
    aws_secret_key: str = "",
) -> Dict[str, Any]:
    """Scan and list security vulnerabilities in AWS infrastructure.

    Specifically checks for:
    - Publicly accessible S3 buckets lacking Public Access Block
    - Unprotected VPC dependencies and orphaned resources
    - Critical and high severity infrastructure misconfigurations

    Args:
        region: AWS region to evaluate (e.g., 'us-east-1', 'eu-west-1'). Defaults to 'us-east-1'.
        aws_access_key: Optional AWS Access Key ID (falls back to AWS_ACCESS_KEY_ID env var / ambient credentials).
        aws_secret_key: Optional AWS Secret Access Key (falls back to AWS_SECRET_ACCESS_KEY env var / ambient credentials).

    Returns:
        Dict[str, Any]: Classified security findings including:
            - region (str): Evaluated AWS region.
            - total_security_issues (int): Total count of security findings.
            - critical_count (int): Count of critical severity issues.
            - high_count (int): Count of high severity issues.
            - medium_count (int): Count of medium severity issues.
            - critical_risks (List[Dict[str, Any]]): Critical finding objects.
            - high_risks (List[Dict[str, Any]]): High finding objects.
            - other_risks (List[Dict[str, Any]]): Medium finding objects.
        Returns error dictionary if the underlying audit fails.
    """
    audit = tuff_audit_aws(
        region=region,
        services="all",
        include_global=True,
        explain_with_ai=False,
        aws_access_key=aws_access_key,
        aws_secret_key=aws_secret_key,
    )

    if "error" in audit:
        return audit

    security_findings = [
        f for f in audit.get("findings", [])
        if f.get("severity") in ("critical", "high") or f.get("resource_type") in ("s3", "vpc")
    ]

    critical = [f for f in security_findings if f.get("severity") == "critical"]
    high = [f for f in security_findings if f.get("severity") == "high"]
    medium = [f for f in security_findings if f.get("severity") == "medium"]

    return {
        "region": region,
        "total_security_issues": len(security_findings),
        "critical_count": len(critical),
        "high_count": len(high),
        "medium_count": len(medium),
        "critical_risks": critical,
        "high_risks": high,
        "other_risks": medium,
    }


@mcp.tool()
def tuff_explain_finding(
    resource_id: str,
    issue: str,
    resource_type: str,
    details: str = "",
    severity: str = "medium",
) -> Dict[str, Any]:
    """Generate root-cause analysis, business impact, and remediation playbook for an infrastructure finding.

    Uses Tuff's AI insights engine (OpenRouter/Groq/OpenAI) if configured, or a deterministic
    rule playbook fallback tailored to the resource type.

    Args:
        resource_id: AWS resource identifier (e.g. 'i-0123456789abcdef0', 'my-bucket').
        issue: Descriptive issue title (e.g. 'Public S3 Bucket', 'Idle EC2 instance (m5.xlarge)').
        resource_type: Target AWS resource type: 'ec2', 'ebs', 's3', 'rds', 'vpc'.
        details: Optional technical details, CloudWatch metric averages, or diagnostic context.
        severity: Severity rating ('critical', 'high', 'medium', 'low'). Defaults to 'medium'.

    Returns:
        Dict[str, Any]: Playbook object containing:
            - source (str): 'tuff_ai_engine' or 'tuff_expert_playbook'.
            - finding (Dict[str, Any]): Echo of the input finding attributes.
            - analysis (Dict[str, Any] | str): Diagnostic report containing:
                - root_cause (str): Underlying cause of the detection.
                - business_impact (str): Financial or operational impact.
                - security_risk (str): Severity assessment ('Elevated' or 'Low').
                - remediation_guide (List[str]): Step-by-step resolution checklist.
                - aws_cli_command (str): Runnable AWS CLI remediation command.
    """
    finding_dict = {
        "resource_id": resource_id,
        "issue": issue,
        "resource_type": resource_type,
        "details": details,
        "severity": severity,
    }

    # Attempt AI synthesis if keys are available
    if ai_insights.ai_configured():
        try:
            explanation, _ = ai_insights.explain_finding(finding_dict)
            return {
                "source": "tuff_ai_engine",
                "finding": finding_dict,
                "analysis": explanation,
            }
        except Exception as e:
            logger.warning("AI explanation fell back to heuristic playbook: %s", e)

    # Deterministic Expert Playbook Fallback
    cli_cmd = ""
    remediation_steps: List[str] = []

    if resource_type == "s3" or "s3" in issue.lower():
        cli_cmd = (
            f"aws s3api put-public-access-block --bucket {resource_id} "
            "--public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
        )
        remediation_steps = [
            f"1. Verify if {resource_id} contains public assets (e.g. static website hosting).",
            "2. If not intended to be public, apply S3 Public Access Block immediately.",
            "3. Audit bucket policies and ACLs to remove Principal: '*' grants.",
            "4. Enable S3 access logging or CloudTrail data events to inspect unauthorized reads.",
        ]
    elif resource_type == "ebs" or "ebs" in issue.lower():
        cli_cmd = (
            f"aws ec2 create-snapshot --volume-id {resource_id} --description 'Tuff pre-deletion backup' && "
            f"aws ec2 delete-volume --volume-id {resource_id}"
        )
        remediation_steps = [
            f"1. Check if volume {resource_id} is needed for recovery.",
            "2. Create a snapshot backup before deletion.",
            f"3. Run 'aws ec2 delete-volume --volume-id {resource_id}' to eliminate ongoing GB/month billing.",
        ]
    elif resource_type == "ec2" and "stopped" in issue.lower():
        cli_cmd = f"aws ec2 terminate-instances --instance-ids {resource_id}"
        remediation_steps = [
            f"1. Confirm instance {resource_id} is no longer required.",
            "2. Ensure attached root/data volumes do not contain unbacked-up state.",
            "3. Terminate instance or detach and snapshot required volumes.",
        ]
    elif resource_type == "ec2" and ("idle" in issue.lower() or "zombie" in issue.lower()):
        cli_cmd = f"aws ec2 stop-instances --instance-ids {resource_id}"
        remediation_steps = [
            f"1. Check running workloads and traffic on {resource_id}.",
            "2. If CPU and network traffic are near zero, stop the instance.",
            "3. Configure an Auto Scaling schedule or CloudWatch alarm to avoid idle running hours.",
        ]
    elif resource_type == "ec2" and "over-provisioned" in issue.lower():
        cli_cmd = (
            f"aws ec2 stop-instances --instance-ids {resource_id} && "
            f"aws ec2 wait instance-stopped --instance-ids {resource_id} && "
            f"aws ec2 modify-instance-attribute --instance-id {resource_id} --instance-type '{{\"Value\": \"t3.medium\"}}' && "
            f"aws ec2 start-instances --instance-ids {resource_id}"
        )
        remediation_steps = [
            f"1. Review 14-day CloudWatch CPU and RAM peaks for {resource_id}.",
            "2. Plan a brief maintenance window to stop the instance.",
            "3. Modify instance type to a smaller family instance (e.g. downsize one size).",
            "4. Start the instance and verify service health.",
        ]
    elif resource_type == "rds":
        cli_cmd = f"aws rds stop-db-instance --db-instance-identifier {resource_id}"
        remediation_steps = [
            f"1. Confirm database {resource_id} has 0 active connections.",
            "2. Temporarily stop the DB instance (AWS allows stopping for up to 7 days).",
            "3. For persistent idle dev/test databases, take a final snapshot and delete.",
        ]
    elif resource_type == "vpc":
        cli_cmd = f"aws ec2 delete-vpc --vpc-id {resource_id}"
        remediation_steps = [
            f"1. Audit any remaining ENIs, subnets, route tables, or gateways attached to {resource_id}.",
            "2. Detach or delete all associated gateway/endpoint attachments.",
            "3. Delete the VPC.",
        ]
    else:
        cli_cmd = f"# Review resource {resource_id} in AWS Console"
        remediation_steps = [
            f"1. Inspect {resource_id} ({resource_type}).",
            "2. Evaluate utilization and security requirements.",
            "3. Apply recommended configuration changes.",
        ]

    return {
        "source": "tuff_expert_playbook",
        "finding": finding_dict,
        "analysis": {
            "root_cause": f"Resource {resource_id} is flagged for '{issue}'. It exhibits low or zero utilization, or permissive security exposure.",
            "business_impact": "Generates unnecessary recurring AWS monthly cost waste or exposes cloud assets to security compromise.",
            "security_risk": "Elevated" if severity in ("critical", "high") else "Low",
            "remediation_guide": remediation_steps,
            "aws_cli_command": cli_cmd,
        },
    }


@mcp.tool()
def tuff_get_least_privilege_iam_policy(
    include_remediation: bool = False,
) -> Dict[str, Any]:
    """Generate the official AWS IAM policy JSON required for Tuff operations.

    Args:
        include_remediation: If True, includes optional execution statements (StopInstances,
            DeleteVolume, PutBucketPublicAccessBlock, etc.). If False (default), returns strictly
            read-only audit permissions.

    Returns:
        Dict[str, Any]:
            - type (str): 'read_and_remediation' or 'read_only'.
            - policy_json (Dict[str, Any]): AWS IAM Policy Document ready to attach to an IAM role or user.
    """
    statements = [
        {
            "Sid": "TuffReadOnlyAuditAccess",
            "Effect": "Allow",
            "Action": [
                "ec2:DescribeInstances",
                "ec2:DescribeInstanceAttribute",
                "ec2:DescribeRegions",
                "ec2:DescribeVolumes",
                "ec2:DescribeVpcs",
                "ec2:DescribeSubnets",
                "ec2:DescribeNetworkInterfaces",
                "ec2:DescribeNatGateways",
                "ec2:DescribeInternetGateways",
                "ec2:DescribeEgressOnlyInternetGateways",
                "ec2:DescribeRouteTables",
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeNetworkAcls",
                "ec2:DescribeVpcEndpoints",
                "ec2:DescribeVpcPeeringConnections",
                "ec2:DescribeVpnGateways",
                "rds:DescribeDBInstances",
                "s3:ListAllMyBuckets",
                "s3:GetBucketPublicAccessBlock",
                "s3:GetBucketLocation",
                "cloudwatch:GetMetricStatistics",
                "cloudwatch:ListMetrics",
                "autoscaling:DescribeAutoScalingGroups",
                "autoscaling:DescribeAutoScalingInstances",
            ],
            "Resource": "*",
        }
    ]

    if include_remediation:
        statements.append({
            "Sid": "TuffOptionalRemediationAccess",
            "Effect": "Allow",
            "Action": [
                "ec2:StopInstances",
                "ec2:StartInstances",
                "ec2:TerminateInstances",
                "ec2:DeleteVolume",
                "ec2:DeleteVpc",
                "ec2:DeleteSubnet",
                "ec2:DeleteInternetGateway",
                "ec2:DetachInternetGateway",
                "ec2:DeleteEgressOnlyInternetGateway",
                "ec2:DeleteRouteTable",
                "ec2:DisassociateRouteTable",
                "ec2:DeleteSecurityGroup",
                "ec2:DeleteNetworkAcl",
                "ec2:ModifyInstanceAttribute",
                "rds:StopDBInstance",
                "rds:DeleteDBInstance",
                "s3:PutBucketPublicAccessBlock",
            ],
            "Resource": "*",
        })

    policy_doc = {
        "Version": "2012-10-17",
        "Statement": statements,
    }

    return {
        "type": "read_and_remediation" if include_remediation else "read_only",
        "policy_json": policy_doc,
    }


@mcp.tool()
def tuff_get_scan_history(limit: int = 5) -> List[Dict[str, Any]]:
    """Retrieve historical scan logs and previous audit runs from the Tuff database.

    Args:
        limit: Maximum number of scan records to return. Defaults to 5.

    Returns:
        List[Dict[str, Any]]: List of historical scan entries, ordered descending by timestamp:
            - scan_id (str): UUID of the scan run.
            - region (str): Scanned AWS region.
            - timestamp (str | None): ISO 8601 formatted timestamp string.
            - findings_count (int): Number of findings identified during the scan.
            - status (str): Audit execution status (e.g. 'completed', 'failed').
            - error_message (str | None): Diagnostic error text if the run encountered issues.
        Returns an empty list if the database is unreachable.
    """
    try:
        db = SessionLocal()
        try:
            logs = (
                db.query(InfrastructureLog)
                .order_by(InfrastructureLog.timestamp.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "scan_id": log.scan_id,
                    "region": log.region,
                    "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                    "findings_count": log.findings_count,
                    "status": log.status,
                    "error_message": log.error_message,
                }
                for log in logs
            ]
        finally:
            db.close()
    except Exception as e:
        logger.warning("Could not read scan history from database: %s", e)
        return []


@mcp.tool()
def tuff_remediate_resource(
    resource_id: str,
    action_type: str,
    region: str = "us-east-1",
    dry_run: bool = True,
    target_type: str = "t3.micro",
    aws_access_key: str = "",
    aws_secret_key: str = "",
) -> Dict[str, Any]:
    """Safely execute or simulate remediation on a flagged AWS resource.

    Actions supported:
    - 'stop_instance': Stops an idle EC2 instance.
    - 'delete_instance': Terminates an unused EC2 instance.
    - 'delete_volume': Deletes an unattached EBS volume.
    - 'delete_vpc': Safely deletes an empty / orphaned VPC.
    - 'stop_rds': Stops an idle RDS instance.
    - 'secure_s3': Enables Public Access Block on an open S3 bucket.
    - 'scale_instance': Rightsizes an over-provisioned EC2 instance to target_type.

    SAFETY: Defaults to dry_run=True. Set dry_run=False ONLY after explicit human confirmation.

    Args:
        resource_id: Identifier of the target resource (e.g. 'i-0123456789', 'vol-0123456789', 'my-bucket').
        action_type: One of 'stop_instance', 'delete_instance', 'delete_volume', 'delete_vpc', 'stop_rds', 'secure_s3', 'scale_instance'.
        region: AWS region of the resource. Defaults to 'us-east-1'.
        dry_run: When True (default), validates pre-flight conditions and existence without altering state.
                 When False, executes the live modification against AWS.
        target_type: Target instance type when action_type is 'scale_instance' (default 't3.micro').
        aws_access_key: Optional AWS Access Key ID (falls back to AWS_ACCESS_KEY_ID env var / ambient credentials).
        aws_secret_key: Optional AWS Secret Access Key (falls back to AWS_SECRET_ACCESS_KEY env var / ambient credentials).

    Returns:
        Dict[str, Any]: Operation result containing:
            - dry_run (bool): Whether the action was simulated.
            - status (str): 'validated' (dry run passed), 'executed' (action applied), or 'failed'.
            - message (str): Human-readable confirmation message.
            - resource_id (str): Identifier of the target resource.
            - action_type (str): Remediation action performed.
            - region (str, optional): Target AWS region.
            - error (str, optional): Diagnostic message if status is 'failed'.
    """
    try:
        engine = _resolve_aws_engine(region, aws_access_key, aws_secret_key)
        action = action_type.strip().lower()

        # Pre-flight check & Dry run validations
        if dry_run:
            if action in ("stop_instance", "scale_instance"):
                engine.assert_instance_stoppable(resource_id)
            elif action == "delete_instance":
                engine.assert_instance_terminable(resource_id)
            elif action == "delete_volume":
                engine.assert_volume_deletable(resource_id)
            elif action == "stop_rds":
                engine.assert_rds_stoppable(resource_id)
            elif action == "delete_vpc":
                # Check VPC exists
                ec2 = engine.client("ec2")
                vpcs = ec2.describe_vpcs(VpcIds=[resource_id]).get("Vpcs", [])
                if not vpcs:
                    raise ValueError(f"VPC {resource_id} not found.")

            return {
                "dry_run": True,
                "status": "validated",
                "message": f"Pre-flight check passed for {action} on {resource_id}. No changes were made.",
                "action_type": action,
                "resource_id": resource_id,
                "region": region,
            }

        # Live Execution
        msg = ""
        if action == "stop_instance":
            engine.assert_instance_stoppable(resource_id)
            engine.client("ec2").stop_instances(InstanceIds=[resource_id])
            msg = f"Stopped idle EC2 instance {resource_id}."

        elif action == "delete_instance":
            engine.assert_instance_terminable(resource_id)
            engine.client("ec2").terminate_instances(InstanceIds=[resource_id])
            msg = f"Terminated EC2 instance {resource_id}."

        elif action == "delete_volume":
            engine.assert_volume_deletable(resource_id)
            engine.client("ec2").delete_volume(VolumeId=resource_id)
            msg = f"Deleted unattached EBS volume {resource_id}."

        elif action == "delete_vpc":
            msg = engine.delete_vpc_safely(resource_id)

        elif action == "stop_rds":
            engine.assert_rds_stoppable(resource_id)
            engine.client("rds").stop_db_instance(DBInstanceIdentifier=resource_id)
            msg = f"Stopped idle RDS instance {resource_id}."

        elif action == "secure_s3":
            engine.client("s3").put_public_access_block(
                Bucket=resource_id,
                PublicAccessBlockConfiguration={
                    "BlockPublicAcls": True,
                    "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                },
            )
            msg = f"Enabled Public Access Block on S3 bucket {resource_id}."

        elif action == "scale_instance":
            engine.assert_instance_stoppable(resource_id)
            ec2 = engine.client("ec2")
            ec2.stop_instances(InstanceIds=[resource_id])
            ec2.get_waiter("instance_stopped").wait(
                InstanceIds=[resource_id],
                WaiterConfig={"Delay": 15, "MaxAttempts": 40},
            )
            ec2.modify_instance_attribute(
                InstanceId=resource_id, InstanceType={"Value": target_type}
            )
            ec2.start_instances(InstanceIds=[resource_id])
            msg = f"Resized instance {resource_id} to {target_type} and restarted it."
        else:
            raise ValueError(f"Unsupported action_type: {action}")

        # Record in execution log if DB available
        try:
            db = SessionLocal()
            try:
                ex_log = ExecutionLog(
                    user_id="mcp_user",
                    resource_id=resource_id,
                    action_type=action,
                    result={"message": msg, "target_type": target_type},
                    execution_status="success",
                )
                db.add(ex_log)
                db.commit()
            finally:
                db.close()
        except Exception as db_err:
            logger.debug("Could not write ExecutionLog: %s", db_err)

        return {
            "dry_run": False,
            "status": "executed",
            "message": msg,
            "resource_id": resource_id,
            "action_type": action,
            "region": region,
        }

    except Exception as exc:
        logger.error("Remediation failed: %s", exc, exc_info=True)
        return {
            "dry_run": dry_run,
            "status": "failed",
            "error": str(exc),
            "resource_id": resource_id,
            "action_type": action_type,
        }


# ---------------------------------------------------------------------------
# MCP Resources & Prompts
# ---------------------------------------------------------------------------


@mcp.resource("tuff://policies/read-only-iam")
def get_iam_policy_resource() -> str:
    """Least-privilege AWS IAM policy JSON for Tuff read-only audits.

    URI: tuff://policies/read-only-iam
    MIME: application/json

    Returns:
        str: Serialized JSON IAM policy document.
    """
    policy = tuff_get_least_privilege_iam_policy(include_remediation=False)
    return json.dumps(policy["policy_json"], indent=2)


@mcp.prompt()
def audit_cloud_costs(region: str = "us-east-1") -> str:
    """Templated prompt to audit cloud cost waste and identify prioritized savings opportunities.

    Args:
        region: AWS region to target in the prompt. Defaults to 'us-east-1'.

    Returns:
        str: Formatted LLM instructions for running a FinOps waste assessment.
    """
    return (
        f"Please run a Tuff cost optimization audit for AWS region '{region}'. "
        "Use the tool `tuff_get_cost_waste_report` to find idle EC2 instances, "
        "unattached EBS volumes, and oversized workloads. "
        "Summarize total monthly and annual dollar waste, rank the top savings opportunities, "
        "and provide step-by-step remediation advice for each finding."
    )


@mcp.prompt()
def audit_security_hardening(region: str = "us-east-1") -> str:
    """Templated prompt to inspect AWS infrastructure for security vulnerabilities and public exposure.

    Args:
        region: AWS region to target in the prompt. Defaults to 'us-east-1'.

    Returns:
        str: Formatted LLM instructions for running a cloud security audit.
    """
    return (
        f"Please perform a security risk audit for AWS region '{region}' using `tuff_get_security_risks`. "
        "Check for public S3 buckets, dangling VPC dependencies, and misconfigured infrastructure. "
        "List all critical and high findings with their root causes and safe remediation commands."
    )


# ---------------------------------------------------------------------------
# Server Entrypoint
# ---------------------------------------------------------------------------


def main():
    """CLI entrypoint for running the Tuff MCP server over stdio or HTTP/SSE transports."""
    parser = argparse.ArgumentParser(description="Tuff MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse", "streamable-http"],
        default="stdio",
        help="Transport protocol (default: stdio)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8001,
        help="Port for SSE / streamable-http transport (default: 8001)",
    )
    args = parser.parse_args()

    if args.transport == "stdio":
        # Run standard IO transport for Claude Desktop, Cursor, Antigravity, etc.
        mcp.run(transport="stdio")
    else:
        # Run HTTP / SSE transport
        mcp.run(transport=args.transport, port=args.port)


if __name__ == "__main__":
    main()
