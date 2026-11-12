"""Unit tests for Tuff Model Context Protocol (MCP) Server."""

import asyncio
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Ensure backend directory is in python path
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from aws_engine import AWSEngine
import mcp_server
from mcp_server import (
    _resolve_aws_engine,
    tuff_audit_aws,
    tuff_get_cost_waste_report,
    tuff_get_security_risks,
    tuff_explain_finding,
    tuff_get_least_privilege_iam_policy,
    tuff_get_scan_history,
    tuff_remediate_resource,
    get_iam_policy_resource,
    audit_cloud_costs,
    audit_security_hardening,
    main,
    mcp,
)


@pytest.fixture(autouse=True)
def mock_db_session():
    """Autouse fixture to mock DB SessionLocal so unit tests don't stall on remote pooler network calls."""
    with patch("mcp_server.SessionLocal") as mock_session_cls:
        mock_db = MagicMock()
        mock_session_cls.return_value = mock_db
        yield mock_session_cls


class TestResolveAWSEngine:
    """Test resolution order and credential fallback for AWSEngine in MCP server."""

    @patch("mcp_server.AWSEngine")
    def test_explicit_credentials_passed(self, mock_engine_cls):
        _resolve_aws_engine(
            region="us-west-2",
            aws_access_key="EXPLICIT_KEY",
            aws_secret_key="EXPLICIT_SECRET",
        )
        mock_engine_cls.assert_called_once_with(
            aws_access_key="EXPLICIT_KEY",
            aws_secret_key="EXPLICIT_SECRET",
            region_name="us-west-2",
        )

    @patch("mcp_server.AWSEngine")
    def test_environment_variables_fallback(self, mock_engine_cls):
        env = {
            "AWS_ACCESS_KEY_ID": "ENV_KEY",
            "AWS_SECRET_ACCESS_KEY": "ENV_SECRET",
            "AWS_REGION": "eu-central-1",
        }
        with patch.dict(os.environ, env, clear=False):
            _resolve_aws_engine(region="", aws_access_key="", aws_secret_key="")

        mock_engine_cls.assert_called_once_with(
            aws_access_key="ENV_KEY",
            aws_secret_key="ENV_SECRET",
            region_name="eu-central-1",
        )

    @patch("mcp_server.AWSEngine")
    def test_ambient_fallback_when_empty(self, mock_engine_cls):
        env_to_remove = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_DEFAULT_REGION"]
        with patch.dict(os.environ, {k: "" for k in env_to_remove}, clear=False):
            _resolve_aws_engine(region="", aws_access_key="", aws_secret_key="")

        mock_engine_cls.assert_called_once_with(
            aws_access_key=None,
            aws_secret_key=None,
            region_name="us-east-1",
        )

    @patch("mcp_server.AWSEngine")
    def test_default_region_fallback(self, mock_engine_cls):
        env = {
            "AWS_ACCESS_KEY_ID": "",
            "AWS_SECRET_ACCESS_KEY": "",
            "AWS_REGION": "",
            "AWS_DEFAULT_REGION": "ap-southeast-1",
        }
        with patch.dict(os.environ, env, clear=False):
            _resolve_aws_engine(region="", aws_access_key="", aws_secret_key="")

        mock_engine_cls.assert_called_once_with(
            aws_access_key=None,
            aws_secret_key=None,
            region_name="ap-southeast-1",
        )


class TestMCPServerRegistrations:
    """Test that all required tools, prompts, and resources are registered on the MCPServer."""

    def test_tools_registered(self):
        tools = asyncio.run(mcp.list_tools())
        tool_names = [t.name for t in tools]

        expected_tools = [
            "tuff_audit_aws",
            "tuff_get_cost_waste_report",
            "tuff_get_security_risks",
            "tuff_explain_finding",
            "tuff_get_least_privilege_iam_policy",
            "tuff_get_scan_history",
            "tuff_remediate_resource",
        ]
        for expected in expected_tools:
            assert expected in tool_names, f"Tool {expected} not registered in MCP server"

    def test_resources_registered(self):
        resources = asyncio.run(mcp.list_resources())
        resource_uris = [str(r.uri) for r in resources]
        assert "tuff://policies/read-only-iam" in resource_uris

    def test_prompts_registered(self):
        prompts = asyncio.run(mcp.list_prompts())
        prompt_names = [p.name for p in prompts]
        assert "audit_cloud_costs" in prompt_names
        assert "audit_security_hardening" in prompt_names


class TestMCPToolsInvocation:
    """Test functionality and edge-case handling of MCP server tools."""

    @patch("mcp_server._resolve_aws_engine")
    @patch("mcp_server.SessionLocal")
    def test_tuff_audit_aws_success_and_metrics(self, mock_session_local, mock_resolve_engine):
        mock_engine = MagicMock()
        mock_resolve_engine.return_value = mock_engine

        mock_engine.scan_zombie_ec2.return_value = [
            {"resource_id": "i-1", "issue": "Idle Instance", "severity": "medium", "estimated_monthly_savings": 50.0}
        ]
        mock_engine.scan_stopped_ec2.return_value = []
        mock_engine.scan_scaling_candidates.return_value = []
        mock_engine.scan_zombie_ebs.return_value = [
            {"resource_id": "vol-1", "issue": "Unattached Volume", "severity": "high", "estimated_monthly_savings": 20.0}
        ]
        mock_engine.scan_public_s3.return_value = [
            {"resource_id": "bucket-1", "issue": "Public Access Block Disabled", "severity": "critical", "estimated_monthly_savings": 0.0}
        ]
        mock_engine.scan_rds.return_value = []
        mock_engine.scan_vpc.return_value = []

        # DB session mock
        mock_db = MagicMock()
        mock_session_local.return_value = mock_db

        result = tuff_audit_aws(region="us-east-1", services="all", include_global=True)

        assert result["region"] == "us-east-1"
        assert result["total_findings"] == 3
        assert result["estimated_monthly_savings_usd"] == 70.0
        assert result["estimated_annual_savings_usd"] == 840.0
        assert result["severity_counts"]["critical"] == 1
        assert result["severity_counts"]["high"] == 1
        assert result["severity_counts"]["medium"] == 1
        assert result["severity_counts"]["low"] == 0
        assert "scan_id" in result
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    @patch("mcp_server._resolve_aws_engine")
    def test_tuff_audit_aws_service_scope_filtering(self, mock_resolve_engine):
        mock_engine = MagicMock()
        mock_resolve_engine.return_value = mock_engine

        mock_engine.scan_zombie_ec2.return_value = [{"resource_id": "i-1", "issue": "Idle"}]
        mock_engine.scan_stopped_ec2.return_value = []
        mock_engine.scan_scaling_candidates.return_value = []

        # Test EC2 only
        result_ec2 = tuff_audit_aws(region="us-east-1", services="ec2")
        mock_engine.scan_zombie_ec2.assert_called_once()
        mock_engine.scan_zombie_ebs.assert_not_called()
        mock_engine.scan_public_s3.assert_not_called()
        assert result_ec2["total_findings"] == 1

    @patch("mcp_server._resolve_aws_engine")
    def test_tuff_audit_aws_deduplication(self, mock_resolve_engine):
        mock_engine = MagicMock()
        mock_resolve_engine.return_value = mock_engine

        # Return duplicated finding
        dup = {"resource_id": "i-dup", "issue": "Duplicate Issue", "severity": "low", "estimated_monthly_savings": 10.0}
        mock_engine.scan_zombie_ec2.return_value = [dup, dup]
        mock_engine.scan_stopped_ec2.return_value = []
        mock_engine.scan_scaling_candidates.return_value = []
        mock_engine.scan_zombie_ebs.return_value = []
        mock_engine.scan_public_s3.return_value = []
        mock_engine.scan_rds.return_value = []
        mock_engine.scan_vpc.return_value = []

        result = tuff_audit_aws(region="us-east-1", services="all")
        assert result["total_findings"] == 1
        assert result["estimated_monthly_savings_usd"] == 10.0

    @patch("mcp_server._resolve_aws_engine")
    def test_tuff_audit_aws_handles_scan_exception_gracefully(self, mock_resolve_engine):
        mock_resolve_engine.side_effect = RuntimeError("AWS Authentication Failure")

        result = tuff_audit_aws(region="us-east-1")
        assert result["status"] == "failed"
        assert "AWS Authentication Failure" in result["error"]
        assert result["region"] == "us-east-1"

    @patch("mcp_server._resolve_aws_engine")
    def test_tuff_audit_aws_individual_service_errors_logged(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine

        # Each service scan raises an exception
        mock_engine.scan_zombie_ec2.side_effect = Exception("EC2 error")
        mock_engine.scan_zombie_ebs.side_effect = Exception("EBS error")
        mock_engine.scan_public_s3.side_effect = Exception("S3 error")
        mock_engine.scan_rds.side_effect = Exception("RDS error")
        mock_engine.scan_vpc.side_effect = Exception("VPC error")

        # Audit should not crash; it logs warnings and returns empty findings
        result = tuff_audit_aws(region="us-east-1", services="all", include_global=True)
        assert result["total_findings"] == 0
        assert result["estimated_monthly_savings_usd"] == 0.0

    @patch("mcp_server._resolve_aws_engine")
    def test_tuff_audit_aws_explain_with_ai(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine

        crit_finding = {
            "resource_id": "bucket-crit",
            "issue": "Public Bucket",
            "severity": "critical",
            "estimated_monthly_savings": 0.0,
        }
        mock_engine.scan_zombie_ec2.return_value = []
        mock_engine.scan_stopped_ec2.return_value = []
        mock_engine.scan_scaling_candidates.return_value = []
        mock_engine.scan_zombie_ebs.return_value = []
        mock_engine.scan_public_s3.return_value = [crit_finding]
        mock_engine.scan_rds.return_value = []
        mock_engine.scan_vpc.return_value = []

        with patch("mcp_server.ai_insights.ai_configured", return_value=True), \
             patch("mcp_server.ai_insights.explain_finding", return_value=({"root_cause": "AI Cause"}, "mock-model")):
            result = tuff_audit_aws(region="us-east-1", explain_with_ai=True)
            assert result["findings"][0]["ai_explanation"] == {"root_cause": "AI Cause"}

    @patch("mcp_server._resolve_aws_engine")
    def test_tuff_audit_aws_explain_with_ai_failure_handled(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine

        crit_finding = {
            "resource_id": "bucket-crit",
            "issue": "Public Bucket",
            "severity": "critical",
        }
        mock_engine.scan_zombie_ec2.return_value = []
        mock_engine.scan_stopped_ec2.return_value = []
        mock_engine.scan_scaling_candidates.return_value = []
        mock_engine.scan_zombie_ebs.return_value = []
        mock_engine.scan_public_s3.return_value = [crit_finding]
        mock_engine.scan_rds.return_value = []
        mock_engine.scan_vpc.return_value = []

        with patch("mcp_server.ai_insights.ai_configured", return_value=True), \
             patch("mcp_server.ai_insights.explain_finding", side_effect=Exception("API limit")):
            result = tuff_audit_aws(region="us-east-1", explain_with_ai=True)
            # Finding is preserved without ai_explanation
            assert "ai_explanation" not in result["findings"][0]

    @patch("mcp_server.tuff_audit_aws")
    def test_tuff_get_cost_waste_report(self, mock_audit):
        mock_audit.return_value = {
            "region": "us-east-1",
            "findings": [
                {
                    "resource_id": "i-1",
                    "resource_type": "ec2",
                    "issue": "Idle Instance",
                    "estimated_monthly_savings": 50.0,
                    "recommendation": "Stop",
                    "action_type": "stop_instance",
                },
                {
                    "resource_id": "vol-1",
                    "resource_type": "ebs",
                    "issue": "Unattached Volume",
                    "estimated_monthly_savings": 25.0,
                    "recommendation": "Delete",
                    "action_type": "delete_volume",
                },
                {
                    "resource_id": "i-2",
                    "resource_type": "ec2",
                    "issue": "Idle Instance 2",
                    "estimated_monthly_savings": 100.0,
                    "recommendation": "Stop",
                    "action_type": "stop_instance",
                },
                {
                    "resource_id": "bucket-1",
                    "resource_type": "s3",
                    "issue": "Public Bucket",
                    "estimated_monthly_savings": 0.0,  # Security only, no cost waste
                },
            ],
        }

        report = tuff_get_cost_waste_report(region="us-east-1")
        assert report["region"] == "us-east-1"
        assert report["total_wasteful_resources"] == 3
        assert report["total_monthly_waste_usd"] == 175.0
        assert report["total_annual_waste_usd"] == 2100.0

        # Top waste opportunity should be sorted descending by savings
        assert report["top_waste_opportunities"][0]["resource_id"] == "i-2"
        assert report["top_waste_opportunities"][0]["estimated_monthly_savings"] == 100.0
        assert report["categories"]["ec2"]["count"] == 2
        assert report["categories"]["ec2"]["monthly_savings"] == 150.0

    @patch("mcp_server.tuff_audit_aws")
    def test_tuff_get_cost_waste_report_error(self, mock_audit):
        mock_audit.return_value = {"error": "Scan failed", "status": "failed"}
        report = tuff_get_cost_waste_report(region="us-east-1")
        assert "error" in report
        assert report["status"] == "failed"

    @patch("mcp_server.tuff_audit_aws")
    def test_tuff_get_security_risks(self, mock_audit):
        mock_audit.return_value = {
            "region": "us-east-1",
            "findings": [
                {"resource_id": "bucket-crit", "resource_type": "s3", "severity": "critical", "issue": "Public S3"},
                {"resource_id": "vpc-high", "resource_type": "vpc", "severity": "high", "issue": "VPC Leak"},
                {"resource_id": "s3-med", "resource_type": "s3", "severity": "medium", "issue": "Missing Encryption"},
                {"resource_id": "ec2-low", "resource_type": "ec2", "severity": "low", "issue": "Low Severity Cost"},
            ],
        }

        risks = tuff_get_security_risks(region="us-east-1")
        assert risks["total_security_issues"] == 3  # 1 critical, 1 high, 1 medium s3
        assert risks["critical_count"] == 1
        assert risks["high_count"] == 1
        assert risks["medium_count"] == 1
        assert risks["critical_risks"][0]["resource_id"] == "bucket-crit"

    @patch("mcp_server.tuff_audit_aws")
    def test_tuff_get_security_risks_error(self, mock_audit):
        mock_audit.return_value = {"error": "Audit error", "status": "failed"}
        res = tuff_get_security_risks(region="us-east-1")
        assert "error" in res
        assert res["status"] == "failed"

    def test_tuff_explain_finding_ai_configured(self):
        with patch("mcp_server.ai_insights.ai_configured", return_value=True), \
             patch("mcp_server.ai_insights.explain_finding", return_value=({"root_cause": "AI Cause"}, "mock_model")):
            res = tuff_explain_finding(
                resource_id="i-12345",
                issue="Idle Instance",
                resource_type="ec2",
                details="CPU avg 1%",
                severity="medium",
            )
            assert res["source"] == "tuff_ai_engine"
            assert res["analysis"]["root_cause"] == "AI Cause"

    def test_tuff_explain_finding_heuristic_fallback_s3(self):
        with patch("mcp_server.ai_insights.ai_configured", return_value=False):
            res = tuff_explain_finding(
                resource_id="my-test-bucket",
                issue="Public Access Block Disabled",
                resource_type="s3",
                severity="critical",
            )
            assert res["source"] == "tuff_expert_playbook"
            assert "aws s3api put-public-access-block" in res["analysis"]["aws_cli_command"]
            assert res["analysis"]["security_risk"] == "Elevated"

    def test_tuff_explain_finding_heuristic_fallback_ebs(self):
        with patch("mcp_server.ai_insights.ai_configured", return_value=False):
            res = tuff_explain_finding(
                resource_id="vol-0123456",
                issue="Unattached EBS Volume",
                resource_type="ebs",
                severity="high",
            )
            assert res["source"] == "tuff_expert_playbook"
            assert "aws ec2 delete-volume --volume-id vol-0123456" in res["analysis"]["aws_cli_command"]

    def test_tuff_explain_finding_heuristic_fallback_ec2_types(self):
        with patch("mcp_server.ai_insights.ai_configured", return_value=False):
            # Stopped EC2
            res_stopped = tuff_explain_finding(
                resource_id="i-stopped",
                issue="Stopped Instance",
                resource_type="ec2",
            )
            assert "aws ec2 terminate-instances" in res_stopped["analysis"]["aws_cli_command"]

            # Idle EC2
            res_idle = tuff_explain_finding(
                resource_id="i-idle",
                issue="Idle Instance",
                resource_type="ec2",
            )
            assert "aws ec2 stop-instances" in res_idle["analysis"]["aws_cli_command"]

            # Over-provisioned EC2
            res_scaled = tuff_explain_finding(
                resource_id="i-scaled",
                issue="Over-provisioned Instance",
                resource_type="ec2",
            )
            assert "modify-instance-attribute" in res_scaled["analysis"]["aws_cli_command"]

            # RDS
            res_rds = tuff_explain_finding(
                resource_id="my-rds-db",
                issue="Idle Database",
                resource_type="rds",
            )
            assert "aws rds stop-db-instance" in res_rds["analysis"]["aws_cli_command"]

            # VPC
            res_vpc = tuff_explain_finding(
                resource_id="vpc-12345",
                issue="Unused VPC",
                resource_type="vpc",
            )
            assert "aws ec2 delete-vpc" in res_vpc["analysis"]["aws_cli_command"]

            # Generic / unknown
            res_gen = tuff_explain_finding(
                resource_id="other-123",
                issue="Other Issue",
                resource_type="other",
            )
            assert "# Review resource other-123 in AWS Console" in res_gen["analysis"]["aws_cli_command"]

    def test_tuff_get_least_privilege_iam_policy(self):
        # Read-only policy
        ro_policy = tuff_get_least_privilege_iam_policy(include_remediation=False)
        assert ro_policy["type"] == "read_only"
        statements = ro_policy["policy_json"]["Statement"]
        assert len(statements) == 1
        assert statements[0]["Sid"] == "TuffReadOnlyAuditAccess"
        assert "ec2:DescribeInstances" in statements[0]["Action"]
        assert "ec2:StopInstances" not in statements[0]["Action"]

        # Read + remediation policy
        remed_policy = tuff_get_least_privilege_iam_policy(include_remediation=True)
        assert remed_policy["type"] == "read_and_remediation"
        remed_statements = remed_policy["policy_json"]["Statement"]
        assert len(remed_statements) == 2
        assert remed_statements[1]["Sid"] == "TuffOptionalRemediationAccess"
        assert "ec2:StopInstances" in remed_statements[1]["Action"]
        assert "s3:PutBucketPublicAccessBlock" in remed_statements[1]["Action"]

    def test_get_iam_policy_resource(self):
        content = get_iam_policy_resource()
        parsed = json.loads(content)
        assert parsed["Version"] == "2012-10-17"
        assert any(stmt["Sid"] == "TuffReadOnlyAuditAccess" for stmt in parsed["Statement"])

    def test_prompts_formatting(self):
        cost_prompt = audit_cloud_costs("eu-west-1")
        assert "eu-west-1" in cost_prompt
        assert "tuff_get_cost_waste_report" in cost_prompt

        sec_prompt = audit_security_hardening("ap-south-1")
        assert "ap-south-1" in sec_prompt
        assert "tuff_get_security_risks" in sec_prompt

    @patch("mcp_server.SessionLocal")
    def test_tuff_get_scan_history(self, mock_session_local):
        mock_db = MagicMock()
        mock_session_local.return_value = mock_db

        mock_log = MagicMock()
        mock_log.scan_id = "test-scan-123"
        mock_log.region = "us-east-1"
        mock_log.timestamp = None
        mock_log.findings_count = 5
        mock_log.status = "completed"
        mock_log.error_message = None

        mock_db.query.return_value.order_by.return_value.limit.return_value.all.return_value = [mock_log]

        history = tuff_get_scan_history(limit=5)
        assert len(history) == 1
        assert history[0]["scan_id"] == "test-scan-123"
        assert history[0]["status"] == "completed"

    @patch("mcp_server.SessionLocal")
    def test_tuff_get_scan_history_db_unreachable(self, mock_session_local):
        mock_session_local.side_effect = Exception("DB Connection Down")
        history = tuff_get_scan_history()
        assert history == []


class TestMCPRemediateResource:
    """Test safety checks, dry-run validations, and live execution of tuff_remediate_resource."""

    @patch("mcp_server._resolve_aws_engine")
    def test_dry_run_validations(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine

        # stop_instance dry run
        res_stop = tuff_remediate_resource("i-1", "stop_instance", dry_run=True)
        mock_engine.assert_instance_stoppable.assert_called_once_with("i-1")
        assert res_stop["dry_run"] is True
        assert res_stop["status"] == "validated"

        # delete_volume dry run
        res_vol = tuff_remediate_resource("vol-1", "delete_volume", dry_run=True)
        mock_engine.assert_volume_deletable.assert_called_once_with("vol-1")
        assert res_vol["dry_run"] is True
        assert res_vol["status"] == "validated"

        # delete_instance dry run
        res_inst = tuff_remediate_resource("i-2", "delete_instance", dry_run=True)
        mock_engine.assert_instance_terminable.assert_called_once_with("i-2")
        assert res_inst["status"] == "validated"

        # stop_rds dry run
        res_rds = tuff_remediate_resource("db-1", "stop_rds", dry_run=True)
        mock_engine.assert_rds_stoppable.assert_called_once_with("db-1")
        assert res_rds["status"] == "validated"

    @patch("mcp_server._resolve_aws_engine")
    def test_live_execution_stop_instance(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine
        mock_ec2 = MagicMock()
        mock_engine.client.return_value = mock_ec2

        res = tuff_remediate_resource("i-1", "stop_instance", dry_run=False)
        mock_engine.assert_instance_stoppable.assert_called_once_with("i-1")
        mock_ec2.stop_instances.assert_called_once_with(InstanceIds=["i-1"])
        assert res["dry_run"] is False
        assert res["status"] == "executed"
        assert "Stopped idle EC2 instance" in res["message"]

    @patch("mcp_server._resolve_aws_engine")
    def test_live_execution_delete_volume(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine
        mock_ec2 = MagicMock()
        mock_engine.client.return_value = mock_ec2

        res = tuff_remediate_resource("vol-1", "delete_volume", dry_run=False)
        mock_engine.assert_volume_deletable.assert_called_once_with("vol-1")
        mock_ec2.delete_volume.assert_called_once_with(VolumeId="vol-1")
        assert res["status"] == "executed"
        assert "Deleted unattached EBS volume" in res["message"]

    @patch("mcp_server._resolve_aws_engine")
    def test_live_execution_secure_s3(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine
        mock_s3 = MagicMock()
        mock_engine.client.return_value = mock_s3

        res = tuff_remediate_resource("my-bucket", "secure_s3", dry_run=False)
        mock_s3.put_public_access_block.assert_called_once()
        assert res["status"] == "executed"
        assert "Enabled Public Access Block" in res["message"]

    @patch("mcp_server._resolve_aws_engine")
    def test_live_execution_delete_vpc(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine
        mock_engine.delete_vpc_safely.return_value = "VPC deleted"

        res = tuff_remediate_resource("vpc-1", "delete_vpc", dry_run=False)
        mock_engine.delete_vpc_safely.assert_called_once_with("vpc-1")
        assert res["status"] == "executed"

    @patch("mcp_server._resolve_aws_engine")
    def test_live_execution_scale_instance(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine
        mock_ec2 = MagicMock()
        mock_engine.client.return_value = mock_ec2

        res = tuff_remediate_resource("i-1", "scale_instance", dry_run=False, target_type="t3.small")
        mock_engine.assert_instance_stoppable.assert_called_once_with("i-1")
        mock_ec2.modify_instance_attribute.assert_called_once_with(
            InstanceId="i-1", InstanceType={"Value": "t3.small"}
        )
        assert res["status"] == "executed"

    @patch("mcp_server._resolve_aws_engine")
    def test_live_execution_delete_instance(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine
        mock_ec2 = MagicMock()
        mock_engine.client.return_value = mock_ec2

        res = tuff_remediate_resource("i-123", "delete_instance", dry_run=False)
        mock_engine.assert_instance_terminable.assert_called_once_with("i-123")
        mock_ec2.terminate_instances.assert_called_once_with(InstanceIds=["i-123"])
        assert res["status"] == "executed"

    @patch("mcp_server._resolve_aws_engine")
    def test_live_execution_stop_rds(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine
        mock_rds = MagicMock()
        mock_engine.client.return_value = mock_rds

        res = tuff_remediate_resource("db-test", "stop_rds", dry_run=False)
        mock_engine.assert_rds_stoppable.assert_called_once_with("db-test")
        mock_rds.stop_db_instance.assert_called_once_with(DBInstanceIdentifier="db-test")
        assert res["status"] == "executed"

    @patch("mcp_server._resolve_aws_engine")
    def test_dry_run_delete_vpc_validations(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine
        mock_ec2 = MagicMock()
        mock_engine.client.return_value = mock_ec2

        # VPC exists
        mock_ec2.describe_vpcs.return_value = {"Vpcs": [{"VpcId": "vpc-1"}]}
        res = tuff_remediate_resource("vpc-1", "delete_vpc", dry_run=True)
        assert res["status"] == "validated"

        # VPC does not exist
        mock_ec2.describe_vpcs.return_value = {"Vpcs": []}
        res_fail = tuff_remediate_resource("vpc-missing", "delete_vpc", dry_run=True)
        assert res_fail["status"] == "failed"
        assert "not found" in res_fail["error"]

    @patch("mcp_server._resolve_aws_engine")
    def test_live_execution_db_logging_error_resilient(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine
        mock_ec2 = MagicMock()
        mock_engine.client.return_value = mock_ec2

        with patch("mcp_server.SessionLocal", side_effect=Exception("DB write error")):
            res = tuff_remediate_resource("i-1", "stop_instance", dry_run=False)
            assert res["status"] == "executed"

    @patch("mcp_server._resolve_aws_engine")
    def test_remediation_unsupported_action(self, mock_resolve_engine):
        mock_engine = MagicMock(spec=AWSEngine)
        mock_resolve_engine.return_value = mock_engine

        res = tuff_remediate_resource("res-1", "unsupported_action", dry_run=False)
        assert res["status"] == "failed"
        assert "Unsupported action_type" in res["error"]


class TestMCPMainEntrypoint:
    """Test CLI arguments handling for running MCP server."""

    @patch.object(mcp, "run")
    def test_main_stdio_default(self, mock_mcp_run):
        with patch.object(sys, "argv", ["mcp_server.py"]):
            main()
            mock_mcp_run.assert_called_once_with(transport="stdio")

    @patch.object(mcp, "run")
    def test_main_sse_transport(self, mock_mcp_run):
        with patch.object(sys, "argv", ["mcp_server.py", "--transport", "sse", "--port", "9000"]):
            main()
            mock_mcp_run.assert_called_once_with(transport="sse", port=9000)
