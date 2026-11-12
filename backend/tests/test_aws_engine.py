"""Unit tests for AWSEngine and AWS cost/security optimization engine."""

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

# Ensure backend directory is in python path
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from aws_engine import (
    AWSEngine,
    _monthly_ec2_cost,
    _monthly_rds_cost,
    _monthly_ebs_cost,
    suggest_smaller_type,
    LOOKBACK_DAYS,
)


class TestAWSEngineInitialization:
    """Test AWSEngine initialization and boto3 credential fallback behavior."""

    @patch("aws_engine.boto3.Session")
    def test_init_with_explicit_credentials(self, mock_session_cls):
        """When explicit credentials are provided, boto3.Session receives them."""
        engine = AWSEngine(
            aws_access_key="AKIAEXAMPLE123",
            aws_secret_key="secretkey456",
            region_name="us-west-2",
        )

        mock_session_cls.assert_called_once_with(
            region_name="us-west-2",
            aws_access_key_id="AKIAEXAMPLE123",
            aws_secret_access_key="secretkey456",
        )
        assert engine.region == "us-west-2"
        assert engine._client_config.connect_timeout == 10
        assert engine._client_config.read_timeout == 30

    @patch("aws_engine.boto3.Session")
    def test_init_with_none_credentials_ambient_fallback(self, mock_session_cls):
        """When credentials are None (default), boto3.Session is called without access keys,
        triggering ambient credentials / IAM role fallback."""
        engine = AWSEngine()

        mock_session_cls.assert_called_once_with(
            region_name="us-east-1",
        )
        assert engine.region == "us-east-1"

    @patch("aws_engine.boto3.Session")
    def test_init_with_partial_credentials(self, mock_session_cls):
        """When only one of access key or secret key is provided, neither should be passed to Session."""
        engine1 = AWSEngine(aws_access_key="AKIAEXAMPLE", aws_secret_key=None, region_name="eu-west-1")
        mock_session_cls.assert_called_with(region_name="eu-west-1")

        mock_session_cls.reset_mock()
        engine2 = AWSEngine(aws_access_key=None, aws_secret_key="secret", region_name="eu-west-1")
        mock_session_cls.assert_called_with(region_name="eu-west-1")

    @patch("aws_engine.boto3.Session")
    def test_client_creation(self, mock_session_cls):
        """client() should delegate to session.client with the configured retry/timeout config."""
        mock_session_inst = MagicMock()
        mock_session_cls.return_value = mock_session_inst

        engine = AWSEngine()
        client = engine.client("ec2")

        mock_session_inst.client.assert_called_once_with("ec2", config=engine._client_config)
        assert client == mock_session_inst.client.return_value


class TestCostHelpers:
    """Test pricing and instance rightsizing helper functions."""

    def test_monthly_ec2_cost_known_type(self):
        # t3.micro is 0.0104 * 730 = 7.592 -> 7.59
        cost = _monthly_ec2_cost("t3.micro")
        assert cost == 7.59

    def test_monthly_ec2_cost_unknown_fallback(self):
        # Fallback is _DEFAULT_EC2_HOURLY_USD (0.10) * 730 = 73.0
        cost = _monthly_ec2_cost("custom.unknown.type")
        assert cost == 73.0

    def test_monthly_rds_cost_known_class(self):
        # db.t3.micro is 0.017 * 730 = 12.41
        cost = _monthly_rds_cost("db.t3.micro")
        assert cost == 12.41

    def test_monthly_rds_cost_unknown_fallback(self):
        # Fallback is _DEFAULT_RDS_HOURLY_USD (0.05) * 730 = 36.5
        cost = _monthly_rds_cost("db.custom.unknown")
        assert cost == 36.5

    def test_monthly_ebs_cost_known_and_fallback(self):
        # gp3: 0.08 * 100 = 8.0
        assert _monthly_ebs_cost(100, "gp3") == 8.0
        # gp2: 0.10 * 100 = 10.0
        assert _monthly_ebs_cost(100, "gp2") == 10.0
        # Fallback: 0.08 * 50 = 4.0
        assert _monthly_ebs_cost(50, "custom_ebs") == 4.0

    def test_suggest_smaller_type_standard_ladder(self):
        assert suggest_smaller_type("t3.xlarge") == "t3.large"
        assert suggest_smaller_type("t3.large") == "t3.medium"
        assert suggest_smaller_type("t3.medium") == "t3.small"
        assert suggest_smaller_type("t3.small") == "t3.micro"
        assert suggest_smaller_type("t3.micro") == "t3.nano"
        assert suggest_smaller_type("t3.nano") == "t3.nano"

    def test_suggest_smaller_type_other_families(self):
        assert suggest_smaller_type("m5.2xlarge") == "m5.xlarge"
        assert suggest_smaller_type("c5.xlarge") == "c5.large"

    def test_suggest_smaller_type_malformed_input(self):
        assert suggest_smaller_type("invalidformat") == "t3.micro"
        assert suggest_smaller_type("t3.unknownsize") == "t3.micro"

    def test_instance_age_hours(self):
        now = datetime.now(timezone.utc)
        inst_with_time = {"LaunchTime": now - timedelta(hours=5)}
        age = AWSEngine._instance_age_hours(inst_with_time)
        assert age is not None
        assert 4.9 <= age <= 5.1

        inst_no_time = {}
        assert AWSEngine._instance_age_hours(inst_no_time) is None


class TestScanFunctions:
    """Test AWS engine resource scanning methods with mocked AWS clients."""

    @pytest.fixture
    def mock_engine(self):
        with patch("aws_engine.boto3.Session"):
            engine = AWSEngine()
            return engine

    def test_scan_zombie_ec2_finds_idle_instance(self, mock_engine):
        mock_ec2 = MagicMock()
        mock_cw = MagicMock()

        launch_time = datetime.now(timezone.utc) - timedelta(days=5)
        instance = {
            "InstanceId": "i-0123456789abcdef0",
            "InstanceType": "t3.medium",
            "LaunchTime": launch_time,
            "Tags": [{"Key": "Name", "Value": "test-idle"}],
        }

        paginator = MagicMock()
        paginator.paginate.return_value = [{"Reservations": [{"Instances": [instance]}]}]
        mock_ec2.get_paginator.return_value = paginator

        # Low CPU and low network metrics
        def mock_metric_stats(**kwargs):
            mname = kwargs.get("MetricName")
            if mname == "CPUUtilization":
                return {"Datapoints": [{"Average": 2.0}, {"Average": 3.0}]}
            elif mname in ("NetworkIn", "NetworkOut"):
                return {"Datapoints": [{"Average": 100.0}]}
            return {"Datapoints": []}

        mock_cw.get_metric_statistics.side_effect = mock_metric_stats

        def client_side_effect(service, **kwargs):
            if service == "ec2":
                return mock_ec2
            if service == "cloudwatch":
                return mock_cw
            return MagicMock()

        mock_engine.client = MagicMock(side_effect=client_side_effect)

        findings = mock_engine.scan_zombie_ec2()
        assert len(findings) == 1
        finding = findings[0]
        assert finding["resource_id"] == "i-0123456789abcdef0"
        assert finding["resource_type"] == "EC2"
        assert finding["issue"] == "Idle Instance"
        assert finding["estimated_monthly_cost"] > 0

    def test_scan_zombie_ec2_skips_active_instance(self, mock_engine):
        mock_ec2 = MagicMock()
        mock_cw = MagicMock()

        launch_time = datetime.now(timezone.utc) - timedelta(days=5)
        instance = {
            "InstanceId": "i-active12345",
            "InstanceType": "t3.medium",
            "LaunchTime": launch_time,
            "Tags": [],
        }

        paginator = MagicMock()
        paginator.paginate.return_value = [{"Reservations": [{"Instances": [instance]}]}]
        mock_ec2.get_paginator.return_value = paginator

        # High CPU (active)
        mock_cw.get_metric_statistics.return_value = {"Datapoints": [{"Average": 45.0}]}

        def client_side_effect(service, **kwargs):
            if service == "ec2":
                return mock_ec2
            if service == "cloudwatch":
                return mock_cw
            return MagicMock()

        mock_engine.client = MagicMock(side_effect=client_side_effect)

        findings = mock_engine.scan_zombie_ec2()
        assert len(findings) == 0

    def test_scan_stopped_ec2(self, mock_engine):
        mock_ec2 = MagicMock()
        stopped_time = datetime.now(timezone.utc) - timedelta(days=3)
        instance = {
            "InstanceId": "i-stopped123",
            "InstanceType": "t3.medium",
            "StateTransitionReason": f"User initiated ({stopped_time.strftime('%Y-%m-%d %H:%M:%S')} GMT)",
            "BlockDeviceMappings": [
                {"Ebs": {"VolumeId": "vol-12345"}}
            ],
            "Tags": [],
        }

        def get_paginator(name):
            if name == "describe_instances":
                p = MagicMock()
                p.paginate.return_value = [{"Reservations": [{"Instances": [instance]}]}]
                return p
            elif name == "describe_volumes":
                p = MagicMock()
                p.paginate.return_value = [{"Volumes": [{"VolumeId": "vol-12345", "Size": 100, "VolumeType": "gp3"}]}]
                return p
            return MagicMock()

        mock_ec2.get_paginator.side_effect = get_paginator
        mock_engine.client = MagicMock(return_value=mock_ec2)

        findings = mock_engine.scan_stopped_ec2()
        assert len(findings) == 1
        assert findings[0]["resource_id"] == "i-stopped123"
        assert findings[0]["issue"] == "Stopped Instance"
        assert findings[0]["estimated_monthly_cost"] == 8.0

    def test_scan_zombie_ebs(self, mock_engine):
        mock_ec2 = MagicMock()
        create_time = datetime.now(timezone.utc) - timedelta(days=10)
        volume = {
            "VolumeId": "vol-idle999",
            "Size": 50,
            "VolumeType": "gp3",
            "State": "available",
            "CreateTime": create_time,
            "Attachments": [],
            "Tags": [],
        }

        paginator = MagicMock()
        paginator.paginate.return_value = [{"Volumes": [volume]}]
        mock_ec2.get_paginator.return_value = paginator
        mock_engine.client = MagicMock(return_value=mock_ec2)

        findings = mock_engine.scan_zombie_ebs()
        assert len(findings) == 1
        assert findings[0]["resource_id"] == "vol-idle999"
        assert findings[0]["issue"] == "Unattached Volume"
        assert findings[0]["estimated_monthly_cost"] == 4.0

    def test_scan_public_s3(self, mock_engine):
        mock_s3 = MagicMock()
        mock_s3.list_buckets.return_value = {
            "Buckets": [{"Name": "public-bucket-test"}]
        }
        mock_s3.get_bucket_location.return_value = {"LocationConstraint": "us-east-1"}

        # Public access block disabled
        mock_s3.get_public_access_block.return_value = {
            "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": False,
                "IgnorePublicAcls": False,
                "BlockPublicPolicy": False,
                "RestrictPublicBuckets": False,
            }
        }
        mock_engine.client = MagicMock(return_value=mock_s3)

        findings = mock_engine.scan_public_s3()
        assert len(findings) == 1
        assert findings[0]["resource_id"] == "public-bucket-test"
        assert findings[0]["issue"] == "Public Access Block Disabled"
        assert findings[0]["severity"] == "critical"

    def test_scan_rds_idle(self, mock_engine):
        mock_rds = MagicMock()
        mock_cw = MagicMock()

        instance = {
            "DBInstanceIdentifier": "prod-db-idle",
            "DBInstanceClass": "db.t3.small",
            "DBInstanceStatus": "available",
            "Engine": "postgres",
        }
        paginator = MagicMock()
        paginator.paginate.return_value = [{"DBInstances": [instance]}]
        mock_rds.get_paginator.return_value = paginator

        # 0 database connections
        mock_cw.get_metric_statistics.return_value = {"Datapoints": [{"Maximum": 0.0}]}

        def client_side_effect(service, **kwargs):
            if service == "rds":
                return mock_rds
            if service == "cloudwatch":
                return mock_cw
            return MagicMock()

        mock_engine.client = MagicMock(side_effect=client_side_effect)

        findings = mock_engine.scan_rds()
        assert len(findings) == 1
        assert findings[0]["resource_id"] == "prod-db-idle"
        assert findings[0]["issue"] == "Idle Database Instance"
        assert findings[0]["estimated_monthly_cost"] > 0

    def test_scan_vpc_unused(self, mock_engine):
        mock_ec2 = MagicMock()
        vpc = {"VpcId": "vpc-test123", "IsDefault": False}
        paginator = MagicMock()
        paginator.paginate.return_value = [{"Vpcs": [vpc]}]
        mock_ec2.get_paginator.return_value = paginator

        # Mock inventory returning empty dependencies
        mock_engine._vpc_dependency_inventory = MagicMock(return_value={
            "eni_count": 0,
            "nat_gateway_count": 0,
            "subnet_count": 0,
            "internet_gateway_count": 0,
            "endpoint_count": 0,
            "peering_count": 0,
            "hard_blockers": [],
            "cleanup_items": [],
        })
        mock_engine.client = MagicMock(return_value=mock_ec2)

        findings = mock_engine.scan_vpc()
        assert len(findings) == 1
        assert findings[0]["resource_id"] == "vpc-test123"
        assert findings[0]["issue"] == "Unused VPC"
        assert findings[0]["severity"] == "medium"

    def test_scan_scaling_candidates(self, mock_engine):
        mock_ec2 = MagicMock()
        mock_cw = MagicMock()

        instance = {
            "InstanceId": "i-oversized123",
            "InstanceType": "t3.xlarge",
            "State": {"Name": "running"},
        }

        mock_engine._running_instances = MagicMock(return_value=[instance])

        # Avg CPU utilization is 6% (below 10%)
        mock_cw.get_metric_statistics.return_value = {"Datapoints": [{"Average": 6.0}]}

        def client_side_effect(service, **kwargs):
            if service == "ec2":
                return mock_ec2
            if service == "cloudwatch":
                return mock_cw
            return MagicMock()

        mock_engine.client = MagicMock(side_effect=client_side_effect)

        findings = mock_engine.scan_scaling_candidates()
        assert len(findings) == 1
        assert findings[0]["resource_id"] == "i-oversized123"
        assert findings[0]["issue"] == "Scaling Candidate"
        assert "t3.large" in findings[0]["recommendation"]

    def test_execute_full_scan_aggregates_and_deduplicates(self, mock_engine):
        mock_engine.scan_zombie_ec2 = MagicMock(return_value=[
            {"resource_id": "i-1", "resource_type": "EC2", "issue": "Idle Instance"}
        ])
        mock_engine.scan_stopped_ec2 = MagicMock(return_value=[])
        mock_engine.scan_zombie_ebs = MagicMock(return_value=[])
        mock_engine.scan_public_s3 = MagicMock(return_value=[
            {"resource_id": "bucket-1", "resource_type": "S3_Bucket", "issue": "Public Access Block Disabled"}
        ])
        mock_engine.scan_rds = MagicMock(return_value=[])
        mock_engine.scan_vpc = MagicMock(return_value=[])
        mock_engine.scan_scaling_candidates = MagicMock(return_value=[])

        findings = mock_engine.execute_full_scan(include_global=True)
        assert len(findings) == 2
        mock_engine.scan_public_s3.assert_called_once()

        # Without global
        mock_engine.scan_public_s3.reset_mock()
        findings_no_global = mock_engine.execute_full_scan(include_global=False)
        assert len(findings_no_global) == 1
        mock_engine.scan_public_s3.assert_not_called()

    def test_deduplicate_helper(self):
        items = [
            {"resource_id": "i-1", "resource_type": "EC2", "issue": "Scaling Candidate", "val": 10},
            {"resource_id": "i-1", "resource_type": "EC2", "issue": "Idle Instance", "val": 20},
            {"resource_id": "r-2", "resource_type": "RDS", "issue": "Idle Database Instance", "val": 30},
        ]
        deduped = AWSEngine._deduplicate(items)
        assert len(deduped) == 2
        # For i-1, "Idle Instance" (priority 3) should win over "Scaling Candidate" (priority 1)
        i1_finding = [f for f in deduped if f["resource_id"] == "i-1"][0]
        assert i1_finding["issue"] == "Idle Instance"
        assert i1_finding["val"] == 20


class TestAWSEngineAssertions:
    """Test safety assertion methods used for remediation validation."""

    @pytest.fixture
    def mock_engine(self):
        with patch("aws_engine.boto3.Session"):
            return AWSEngine()

    def test_assert_volume_deletable(self, mock_engine):
        mock_ec2 = MagicMock()
        mock_ec2.describe_volumes.return_value = {
            "Volumes": [{"VolumeId": "vol-1", "State": "available", "Attachments": []}]
        }
        mock_engine.client = MagicMock(return_value=mock_ec2)

        # Should pass without exception
        mock_engine.assert_volume_deletable("vol-1")

        # In-use volume should raise RuntimeError
        mock_ec2.describe_volumes.return_value = {
            "Volumes": [{"VolumeId": "vol-1", "State": "in-use", "Attachments": [{"InstanceId": "i-1"}]}]
        }
        with pytest.raises(RuntimeError, match="Detach it in AWS before Tuff can delete it"):
            mock_engine.assert_volume_deletable("vol-1")

    def test_assert_instance_exists_and_terminable(self, mock_engine):
        mock_ec2 = MagicMock()
        mock_ec2.describe_instances.return_value = {
            "Reservations": [{"Instances": [{"InstanceId": "i-1", "State": {"Name": "running"}}]}]
        }
        mock_ec2.describe_instance_attribute.return_value = {
            "DisableApiTermination": {"Value": False}
        }
        mock_engine.client = MagicMock(return_value=mock_ec2)

        inst = mock_engine.assert_instance_exists("i-1")
        assert inst["InstanceId"] == "i-1"

        # Running instance is terminable
        mock_engine.assert_instance_terminable("i-1")

        # Terminated instance is not terminable
        mock_ec2.describe_instances.return_value = {
            "Reservations": [{"Instances": [{"InstanceId": "i-1", "State": {"Name": "terminated"}}]}]
        }
        with pytest.raises(RuntimeError, match="already terminated"):
            mock_engine.assert_instance_terminable("i-1")

    def test_assert_instance_stoppable(self, mock_engine):
        mock_ec2 = MagicMock()
        mock_ec2.describe_instances.return_value = {
            "Reservations": [{"Instances": [{"InstanceId": "i-1", "State": {"Name": "stopped"}}]}]
        }
        mock_engine.client = MagicMock(return_value=mock_ec2)

        with pytest.raises(RuntimeError, match="cannot be stopped right now"):
            mock_engine.assert_instance_stoppable("i-1")

        # Running instance passes
        mock_ec2.describe_instances.return_value = {
            "Reservations": [{"Instances": [{"InstanceId": "i-1", "State": {"Name": "running"}}]}]
        }
        mock_engine.assert_instance_stoppable("i-1")

    def test_assert_rds_stoppable(self, mock_engine):
        mock_rds = MagicMock()
        mock_rds.describe_db_instances.return_value = {
            "DBInstances": [{"DBInstanceIdentifier": "db-1", "DBInstanceStatus": "available", "Engine": "postgres"}]
        }
        mock_engine.client = MagicMock(return_value=mock_rds)

        # Available RDS is stoppable
        mock_engine.assert_rds_stoppable("db-1")

        # Stopped RDS raises RuntimeError
        mock_rds.describe_db_instances.return_value = {
            "DBInstances": [{"DBInstanceIdentifier": "db-1", "DBInstanceStatus": "stopped", "Engine": "postgres"}]
        }
        with pytest.raises(RuntimeError, match="Wait until it is available, then retry"):
            mock_engine.assert_rds_stoppable("db-1")

        # RDS not found raises RuntimeError
        mock_rds.describe_db_instances.return_value = {"DBInstances": []}
        with pytest.raises(RuntimeError, match="not found"):
            mock_engine.assert_rds_stoppable("db-missing")

        # Aurora RDS raises RuntimeError
        mock_rds.describe_db_instances.return_value = {
            "DBInstances": [{"DBInstanceIdentifier": "db-aurora", "DBInstanceStatus": "available", "Engine": "aurora-postgresql"}]
        }
        with pytest.raises(RuntimeError, match="Aurora"):
            mock_engine.assert_rds_stoppable("db-aurora")

    def test_assert_instance_exists_not_found(self, mock_engine):
        mock_ec2 = MagicMock()
        mock_ec2.describe_instances.return_value = {"Reservations": []}
        mock_engine.client = MagicMock(return_value=mock_ec2)

        with pytest.raises(RuntimeError, match="not found"):
            mock_engine.assert_instance_exists("i-missing")

    def test_assert_instance_terminable_protection_enabled(self, mock_engine):
        mock_ec2 = MagicMock()
        mock_ec2.describe_instances.return_value = {
            "Reservations": [{"Instances": [{"InstanceId": "i-1", "State": {"Name": "running"}}]}]
        }
        mock_ec2.describe_instance_attribute.return_value = {
            "DisableApiTermination": {"Value": True}
        }
        mock_engine.client = MagicMock(return_value=mock_ec2)

        with pytest.raises(RuntimeError, match="termination protection enabled"):
            mock_engine.assert_instance_terminable("i-1")

    def test_delete_vpc_safely_validations(self, mock_engine):
        mock_ec2 = MagicMock()
        mock_engine.client = MagicMock(return_value=mock_ec2)

        # VPC not found
        mock_ec2.describe_vpcs.return_value = {"Vpcs": []}
        with pytest.raises(RuntimeError, match="not found"):
            mock_engine.delete_vpc_safely("vpc-missing")

        # Refuse to delete default VPC
        mock_ec2.describe_vpcs.return_value = {"Vpcs": [{"VpcId": "vpc-def", "IsDefault": True}]}
        with pytest.raises(RuntimeError, match="Refusing to delete default VPC"):
            mock_engine.delete_vpc_safely("vpc-def")

        # Hard blockers present
        mock_ec2.describe_vpcs.return_value = {"Vpcs": [{"VpcId": "vpc-custom", "IsDefault": False}]}
        mock_engine._vpc_dependency_inventory = MagicMock(return_value={
            "hard_blockers": ["1 active NAT gateway(s)"],
            "internet_gateway_ids": [],
            "egress_only_igw_ids": [],
            "route_tables": [],
            "non_default_acl_ids": [],
            "non_default_sg_ids": [],
            "subnet_ids": [],
        })
        with pytest.raises(RuntimeError, match="blocking dependencies"):
            mock_engine.delete_vpc_safely("vpc-custom")

        # Success case
        mock_engine._vpc_dependency_inventory = MagicMock(return_value={
            "hard_blockers": [],
            "internet_gateway_ids": ["igw-1"],
            "egress_only_igw_ids": ["eigw-1"],
            "route_tables": [{"RouteTableId": "rt-1", "Associations": []}],
            "non_default_acl_ids": ["acl-1"],
            "non_default_sg_ids": ["sg-1"],
            "subnet_ids": ["subnet-1"],
        })
        msg = mock_engine.delete_vpc_safely("vpc-custom")
        assert "Ordered VPC cleanup complete" in msg
        mock_ec2.delete_vpc.assert_called_once_with(VpcId="vpc-custom")
