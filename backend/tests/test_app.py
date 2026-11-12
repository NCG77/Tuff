"""Unit tests for backend FastAPI application endpoints, models, and utility functions."""

from datetime import datetime, timezone
import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

import app as app_module
from app import (
    ActionLogRequest,
    AlertConfigRequest,
    BuyCreditsRequest,
    ExecuteRequest,
    ScanRequest,
    _validate_region,
    app,
    finding_uid,
    format_datetime,
)

client = TestClient(app)


class TestAppHelpers:
    """Tests for standalone helper functions in app.py."""

    def test_format_datetime_none(self):
        assert format_datetime(None) is None

    def test_format_datetime_naive(self):
        dt = datetime(2026, 11, 12, 12, 0, 0)
        formatted = format_datetime(dt)
        assert formatted == "2026-11-12T12:00:00Z"

    def test_format_datetime_aware(self):
        dt = datetime(2026, 11, 12, 12, 0, 0, tzinfo=timezone.utc)
        formatted = format_datetime(dt)
        assert formatted == "2026-11-12T12:00:00Z"

    def test_format_datetime_non_datetime(self):
        assert format_datetime("2026-11-12") == "2026-11-12"

    def test_finding_uid(self):
        uid = finding_uid("vol-12345", "Zombie EBS Volume")
        assert uid == "vol-12345::Zombie EBS Volume"

    def test_validate_region_valid(self):
        assert _validate_region("us-east-1") == "us-east-1"
        assert _validate_region("EU-WEST-1 ") == "eu-west-1"
        assert _validate_region("ap-south-1") == "ap-south-1"

    def test_validate_region_allow_all(self):
        assert _validate_region("all", allow_all=True) == "all"
        assert _validate_region("ALL ", allow_all=True) == "all"
        with pytest.raises(ValueError, match="valid AWS region"):
            _validate_region("all", allow_all=False)

    def test_validate_region_invalid(self):
        with pytest.raises(ValueError, match="valid AWS region"):
            _validate_region("invalid-region")
        with pytest.raises(ValueError, match="valid AWS region"):
            _validate_region("us-east-")
        with pytest.raises(ValueError, match="valid AWS region"):
            _validate_region("")


class TestAppRequestModels:
    """Tests for Pydantic models validation in app.py."""

    def test_scan_request_valid(self):
        req = ScanRequest(
            aws_access_key="AKIA1234567890",
            aws_secret_key="secretkey123",
            region="us-west-2",
        )
        assert req.region == "us-west-2"

    def test_scan_request_allow_all_region(self):
        req = ScanRequest(
            aws_access_key="AKIA1234567890",
            aws_secret_key="secretkey123",
            region="all",
        )
        assert req.region == "all"

    def test_scan_request_invalid_region(self):
        with pytest.raises(ValidationError):
            ScanRequest(
                aws_access_key="AKIA123",
                aws_secret_key="secret",
                region="bad-region-name",
            )

    def test_execute_request_valid(self):
        req = ExecuteRequest(
            aws_access_key="AKIA123",
            aws_secret_key="secret",
            region="us-east-1",
            resource_id="i-0123456789abcdef0",
            action_type="stop_instance",
        )
        assert req.action_type == "stop_instance"
        assert req.resource_id == "i-0123456789abcdef0"

    def test_execute_request_unsupported_action(self):
        with pytest.raises(ValidationError, match="must be one of"):
            ExecuteRequest(
                aws_access_key="AKIA123",
                aws_secret_key="secret",
                region="us-east-1",
                resource_id="i-0123456789abcdef0",
                action_type="invalid_action",
            )

    def test_execute_request_target_type_validation(self):
        req = ExecuteRequest(
            aws_access_key="AKIA123",
            aws_secret_key="secret",
            region="us-east-1",
            resource_id="i-0123456789abcdef0",
            action_type="scale_instance",
            target_type="t3.micro",
        )
        assert req.target_type == "t3.micro"

        with pytest.raises(ValidationError, match="EC2 instance type"):
            ExecuteRequest(
                aws_access_key="AKIA123",
                aws_secret_key="secret",
                region="us-east-1",
                resource_id="i-0123456789abcdef0",
                action_type="scale_instance",
                target_type="not-an-instance-type",
            )

    def test_alert_config_request(self):
        req = AlertConfigRequest(
            resourceType="ec2",
            metric="cpu",
            threshold=80.0,
            thresholdType="above",
        )
        assert req.metric == "cpu"
        assert req.thresholdType == "above"

        with pytest.raises(ValidationError, match="cpu, save, cur"):
            AlertConfigRequest(
                resourceType="ec2",
                metric="invalid_metric",
                threshold=50.0,
                thresholdType="above",
            )

        with pytest.raises(ValidationError, match="'above' or 'below'"):
            AlertConfigRequest(
                resourceType="ec2",
                metric="cpu",
                threshold=50.0,
                thresholdType="higher",
            )

    def test_buy_credits_request(self):
        req = BuyCreditsRequest(plan="monthly")
        assert req.plan == "monthly"
        req_year = BuyCreditsRequest(plan="yearly")
        assert req_year.plan == "yearly"

        with pytest.raises(ValidationError, match="must be one of"):
            BuyCreditsRequest(plan="weekly")

    def test_action_log_request(self):
        req = ActionLogRequest(
            resource_id="vol-012345",
            action="Approved",
            resource_type="volume",
        )
        assert req.resource_id == "vol-012345"
        assert req.action == "Approved"

        with pytest.raises(ValidationError, match="'Approved' or 'Dismissed'"):
            ActionLogRequest(
                resource_id="vol-012345",
                action="invalid_action",
                resource_type="volume",
            )


class TestAppEndpoints:
    """Tests for public and unprotected HTTP endpoints."""

    def test_root_endpoint(self):
        response = client.get("/")
        assert response.status_code == 200
        payload = response.json()
        assert "message" in payload
        assert "health" in payload
        assert "main_endpoint" in payload

    def test_health_check_endpoint(self):
        response = client.get("/api/health")
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "healthy"
        assert "service" in payload
        assert "version" in payload
        assert "ai_configured" in payload

    def test_protected_routes_require_auth(self):
        # Without authorization header, protected endpoints should return 401
        res = client.get("/api/me/bootstrap")
        assert res.status_code in {401, 403}

        res = client.get("/api/alerts/config")
        assert res.status_code in {401, 403}

        res = client.get("/api/logs/execution")
        assert res.status_code in {401, 403}

        res = client.post("/api/user/sync", json={})
        assert res.status_code in {401, 403}
