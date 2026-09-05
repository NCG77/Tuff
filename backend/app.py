import concurrent.futures
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, text
from sqlalchemy.orm import Session

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Prefer .env.local (local overrides) then .env. load_dotenv alone only looks
# for ".env", which is why a backend that only ships .env.local previously
# started with every setting missing.
_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, ".env.local"))
load_dotenv(os.path.join(_HERE, ".env"))

from ai_insights import CREDITS_PER_FINDING, ai_configured, explain_finding, humanize_insight
from aws_engine import AWSEngine
from db import (
    ActionLog,
    AlertConfig,
    ExecutionLog,
    InfrastructureLog,
    PaymentOrder,
    TriggeredAlert,
    UserSubscription,
    get_db,
    init_db,
    utcnow,
)
from security import (
    ENVIRONMENT,
    IS_PRODUCTION,
    CredentialDecryptionError,
    decrypt_credential,
    get_current_user,
    is_trusted_sns_url,
    rate_limit,
    verify_webhook_secret,
)

# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

import razorpay

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
PAYMENTS_ENABLED = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)

razorpay_client = (
    razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)) if PAYMENTS_ENABLED else None
)
if not PAYMENTS_ENABLED:
    logger.warning("Razorpay keys are not configured; upgrade endpoints will return 503.")

PLAN_PRICING_PAISE = {"monthly": 29900, "yearly": 339900}

# Credits granted per plan. The yearly plan costs a little over 11 months of
# the monthly one, so it grants a full 12 months of credits -- previously both
# plans granted a flat 10,000, which meant a yearly subscriber paid 11x as much
# for exactly the same allowance.
PLAN_CREDIT_GRANT = {"monthly": 10_000, "yearly": 120_000}

# Ceiling on how much work one scan request may queue, so a very large AWS
# account cannot tie up the process indefinitely.
MAX_FINDINGS_PER_SCAN = 250
MAX_PARALLEL_REGIONS = 6
MAX_PARALLEL_AI_CALLS = 8

_REGION_PATTERN = re.compile(r"^[a-z]{2}(?:-[a-z]+)+-\d$")
_RESOURCE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-/]{0,254}$")
_INSTANCE_TYPE_PATTERN = re.compile(r"^[a-z0-9]+\.[a-z0-9]+$")

SUPPORTED_ACTIONS = {
    "stop_instance",
    "delete_instance",
    "scale_instance",
    "delete_volume",
    "delete_vpc",
    "stop_rds",
    "delete_rds",
    "secure_s3",
}

# Actions that destroy data. These are logged loudly and, for RDS, forced to
# take a final snapshot first.
DESTRUCTIVE_ACTIONS = {"delete_instance", "delete_volume", "delete_vpc", "delete_rds"}


def format_datetime(dt: Optional[datetime]) -> Optional[str]:
    """Serialise a stored UTC timestamp as an explicit UTC ISO-8601 string.

    Timestamps are stored naive-UTC. Emitting them without a zone made
    browsers parse them as local time, so every log entry appeared shifted by
    the viewer's UTC offset.
    """
    if dt is None:
        return None
    if not isinstance(dt, datetime):
        return str(dt)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def finding_uid(resource_id: str, issue: str) -> str:
    """Stable per-finding key.

    A single resource can raise more than one kind of finding, so the AWS
    resource id alone is not unique. The UI needs a unique key to track which
    row was approved or dismissed.
    """
    return f"{resource_id}::{issue}"


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    logger.info("Database initialized successfully (environment=%s)", ENVIRONMENT)
    if not ai_configured():
        logger.warning("No AI provider configured; /api/analyze will reject requests.")
    yield


app = FastAPI(
    title="TUFF Backend API",
    description="Cloud Infrastructure Analysis Engine with Tiered AI Processing",
    version="1.0.0",
    lifespan=lifespan,
    # The interactive docs expose every route and schema; keep them off in
    # production deployments.
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None,
)

_configured_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_URL", "http://localhost:3000").split(",")
    if origin.strip()
]

# A wildcard origin combined with credentialed requests is rejected by browsers
# and would allow any site to drive the API on a signed-in user's behalf, so
# the allowed origins are always explicit.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_configured_origins,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_credentials=True,
    allow_headers=["Authorization", "Content-Type"],
)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


def _validate_region(value: str, allow_all: bool = False) -> str:
    region = (value or "").strip().lower()
    if allow_all and region == "all":
        return region
    if not _REGION_PATTERN.match(region):
        raise ValueError("must be a valid AWS region such as us-east-1")
    return region


class ScanRequest(BaseModel):
    aws_access_key: str = Field(min_length=1, max_length=4096)
    aws_secret_key: str = Field(min_length=1, max_length=4096)
    region: str = "us-east-1"

    @field_validator("region")
    @classmethod
    def check_region(cls, value: str) -> str:
        return _validate_region(value, allow_all=True)


class ExecuteRequest(BaseModel):
    aws_access_key: str = Field(min_length=1, max_length=4096)
    aws_secret_key: str = Field(min_length=1, max_length=4096)
    region: str = "us-east-1"
    resource_id: str = Field(min_length=1, max_length=255)
    action_type: str
    target_type: Optional[str] = None

    @field_validator("region")
    @classmethod
    def check_region(cls, value: str) -> str:
        return _validate_region(value)

    @field_validator("resource_id")
    @classmethod
    def check_resource_id(cls, value: str) -> str:
        value = value.strip()
        if not _RESOURCE_ID_PATTERN.match(value):
            raise ValueError("is not a valid AWS resource identifier")
        return value

    @field_validator("action_type")
    @classmethod
    def check_action(cls, value: str) -> str:
        value = (value or "").strip()
        if value not in SUPPORTED_ACTIONS:
            raise ValueError(f"must be one of: {', '.join(sorted(SUPPORTED_ACTIONS))}")
        return value

    @field_validator("target_type")
    @classmethod
    def check_target_type(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip().lower()
        if not _INSTANCE_TYPE_PATTERN.match(value):
            raise ValueError("must look like an EC2 instance type, e.g. t3.micro")
        return value


class AlertConfigRequest(BaseModel):
    resourceType: str = Field(min_length=1, max_length=32)
    metric: str
    threshold: float = Field(ge=0, le=1_000_000)
    thresholdType: str

    @field_validator("metric")
    @classmethod
    def check_metric(cls, value: str) -> str:
        value = (value or "").strip().lower()
        if value not in {"cpu", "save", "cur"}:
            raise ValueError("must be one of: cpu, save, cur")
        return value

    @field_validator("thresholdType")
    @classmethod
    def check_threshold_type(cls, value: str) -> str:
        value = (value or "").strip().lower()
        if value not in {"above", "below"}:
            raise ValueError("must be either 'above' or 'below'")
        return value


class AlertEvaluateRequest(BaseModel):
    findings: list = Field(default_factory=list, max_length=MAX_FINDINGS_PER_SCAN)


class PaymentVerifyRequest(BaseModel):
    razorpay_order_id: str = Field(min_length=1, max_length=128)
    razorpay_payment_id: str = Field(min_length=1, max_length=128)
    razorpay_signature: str = Field(min_length=1, max_length=512)


class BuyCreditsRequest(BaseModel):
    plan: str = "monthly"

    @field_validator("plan")
    @classmethod
    def check_plan(cls, value: str) -> str:
        value = (value or "").strip().lower()
        if value not in PLAN_PRICING_PAISE:
            raise ValueError(f"must be one of: {', '.join(PLAN_PRICING_PAISE)}")
        return value


class HumanizeRequest(BaseModel):
    explanation: str = Field(default="", max_length=4000)
    business_impact: str = Field(default="", max_length=4000)
    recommended_action: str = Field(default="", max_length=4000)


class ActionLogRequest(BaseModel):
    resource_id: str = Field(min_length=1, max_length=255)
    action: str = Field(min_length=1, max_length=32)
    resource_type: str = Field(min_length=1, max_length=128)

    @field_validator("action")
    @classmethod
    def check_action(cls, value: str) -> str:
        value = (value or "").strip()
        if value not in {"Approved", "Dismissed"}:
            raise ValueError("must be either 'Approved' or 'Dismissed'")
        return value


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_user(db: Session, user_id: str) -> UserSubscription:
    """Fetch the caller's subscription row, provisioning it on first use.

    Several endpoints previously assumed ``/api/user/sync`` had already run and
    crashed with an AttributeError when it had not.
    """
    record = db.query(UserSubscription).filter(UserSubscription.user_id == user_id).first()
    if record is None:
        record = UserSubscription(user_id=user_id, subscription_tier="free")
        db.add(record)
        db.commit()
        db.refresh(record)
        logger.info("Provisioned new user profile: %s", user_id)
    return record


def _spend_credits(db: Session, user_id: str, amount: int) -> None:
    """Deduct credits with a single conditional UPDATE.

    Read-modify-write on the ORM object lost concurrent updates when two scans
    overlapped; doing the arithmetic in the database keeps the balance correct
    and stops it going negative.
    """
    if amount <= 0:
        return
    db.execute(
        text(
            "UPDATE user_subscriptions "
            "SET credits = GREATEST(credits - :amount, 0), updated_at = :now "
            "WHERE user_id = :user_id"
        ),
        {"amount": amount, "now": utcnow(), "user_id": user_id},
    )
    db.commit()


def _safe_rollback(db: Session) -> None:
    """Discard a failed transaction before reusing the session.

    Error handlers that wrote an audit record used to fail silently because the
    session was already in an aborted state.
    """
    try:
        db.rollback()
    except Exception:
        logger.exception("Failed to roll back session")


def _log_scan_failure(db: Session, scan_id: str, user_id: str, region: str, message: str) -> None:
    _safe_rollback(db)
    try:
        db.add(
            InfrastructureLog(
                scan_id=scan_id,
                user_id=user_id,
                region=region,
                findings=[],
                findings_count=0,
                status="failed",
                error_message=message[:500],
            )
        )
        db.commit()
    except Exception:
        logger.exception("Failed to persist scan failure for %s", scan_id)
        _safe_rollback(db)


def _decrypt_aws_credentials(request) -> tuple:
    try:
        return (
            decrypt_credential(request.aws_access_key, "AWS access key"),
            decrypt_credential(request.aws_secret_key, "AWS secret key"),
        )
    except CredentialDecryptionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _parse_metric(raw) -> Optional[float]:
    """Read a number out of a display string such as ``"$174/mo"`` or ``"3.2%"``.

    ``float()`` on these raises, which previously surfaced as a 500 from alert
    evaluation.
    """
    if isinstance(raw, (int, float)):
        return float(raw)
    if not isinstance(raw, str):
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", raw.replace(",", ""))
    return float(match.group()) if match else None


# ---------------------------------------------------------------------------
# User & billing
# ---------------------------------------------------------------------------


@app.post("/api/user/sync")
async def sync_user_tier(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Called by the frontend immediately after a successful Firebase login.
    Checks if the user exists. If not, provisions a free-tier profile.
    """
    try:
        user_record = _ensure_user(db, current_user["uid"])
        return JSONResponse(content={
            "status": "synchronized",
            "tier": user_record.subscription_tier,
            "credits": user_record.credits,
            "user_id": user_record.user_id,
            "credits_per_finding": CREDITS_PER_FINDING,
        })
    except Exception:
        logger.exception("Failed to synchronize user profile")
        _safe_rollback(db)
        raise HTTPException(status_code=500, detail="Could not load your profile. Please try again.")


@app.post("/api/user/credits/buy")
async def create_razorpay_order(
    request: BuyCreditsRequest,
    current_user: dict = Depends(rate_limit(10, 300, "buy")),
    db: Session = Depends(get_db),
):
    if not PAYMENTS_ENABLED:
        raise HTTPException(status_code=503, detail="Payments are not configured on this deployment.")

    user_id = current_user["uid"]
    amount = PLAN_PRICING_PAISE[request.plan]

    try:
        order = razorpay_client.order.create({
            "amount": amount,
            "currency": "INR",
            "receipt": f"tuff_{uuid.uuid4().hex[:16]}",
            "payment_capture": 1,
            "notes": {"user_id": user_id, "plan": request.plan},
        })
    except Exception:
        logger.exception("Failed to create Razorpay order for %s", user_id)
        raise HTTPException(status_code=502, detail="Could not start checkout. Please try again.")

    try:
        # Recording the order server-side is what lets verification confirm the
        # payment belongs to this user, was for this amount, and has not
        # already been redeemed.
        db.add(
            PaymentOrder(
                order_id=order["id"],
                user_id=user_id,
                plan=request.plan,
                amount=amount,
                currency="INR",
                status="created",
            )
        )
        db.commit()
    except Exception:
        logger.exception("Failed to persist Razorpay order %s", order.get("id"))
        _safe_rollback(db)
        raise HTTPException(status_code=500, detail="Could not start checkout. Please try again.")

    return JSONResponse(content={"order_id": order["id"], "amount": amount, "currency": "INR"})


@app.post("/api/user/verify-payment")
async def verify_payment(
    req: PaymentVerifyRequest,
    current_user: dict = Depends(rate_limit(20, 300, "verify")),
    db: Session = Depends(get_db),
):
    if not PAYMENTS_ENABLED:
        raise HTTPException(status_code=503, detail="Payments are not configured on this deployment.")

    user_id = current_user["uid"]

    order = (
        db.query(PaymentOrder)
        .filter(PaymentOrder.order_id == req.razorpay_order_id)
        .with_for_update()
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Unknown payment order.")
    if order.user_id != user_id:
        # Never confirm or deny another user's order; treat it as not found.
        logger.warning("User %s attempted to redeem order owned by %s", user_id, order.user_id)
        raise HTTPException(status_code=404, detail="Unknown payment order.")
    if order.status == "paid":
        # Idempotent: replaying a completed payment must not grant credits again.
        user_record = _ensure_user(db, user_id)
        return {"status": "success", "tier": user_record.subscription_tier, "credits": user_record.credits}

    try:
        razorpay_client.utility.verify_payment_signature({
            "razorpay_order_id": req.razorpay_order_id,
            "razorpay_payment_id": req.razorpay_payment_id,
            "razorpay_signature": req.razorpay_signature,
        })
    except razorpay.errors.SignatureVerificationError:
        order.status = "failed"
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid payment signature.")
    except Exception:
        logger.exception("Payment signature verification errored for order %s", req.razorpay_order_id)
        _safe_rollback(db)
        raise HTTPException(status_code=502, detail="Could not verify the payment. Please contact support.")

    try:
        # Confirm with Razorpay that the captured amount matches the order, so a
        # tampered client cannot upgrade by paying less.
        payment = razorpay_client.payment.fetch(req.razorpay_payment_id)
        if int(payment.get("amount", 0)) < order.amount or payment.get("order_id") != order.order_id:
            logger.warning("Payment %s does not match order %s", req.razorpay_payment_id, order.order_id)
            raise HTTPException(status_code=400, detail="Payment does not match the order.")
    except HTTPException:
        raise
    except Exception:
        # A fetch failure should not block a cryptographically valid payment.
        logger.warning("Could not fetch payment %s for cross-check", req.razorpay_payment_id, exc_info=True)

    try:
        user_record = _ensure_user(db, user_id)
        user_record.subscription_tier = "pro"
        # The plan comes from the order recorded at checkout, never from the
        # request body, so the granted amount cannot be inflated by the client.
        user_record.credits += PLAN_CREDIT_GRANT.get(order.plan, PLAN_CREDIT_GRANT["monthly"])
        user_record.razorpay_customer_id = user_record.razorpay_customer_id or user_id
        user_record.updated_at = utcnow()

        order.status = "paid"
        order.payment_id = req.razorpay_payment_id
        order.updated_at = utcnow()
        db.commit()
    except Exception:
        logger.exception("Failed to apply upgrade for order %s", order.order_id)
        _safe_rollback(db)
        raise HTTPException(status_code=500, detail="Payment captured but the upgrade failed. Please contact support.")

    logger.info("User %s upgraded to pro via order %s", user_id, order.order_id)
    return {"status": "success", "tier": "pro", "credits": user_record.credits}


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------


@app.post("/api/webhooks/aws")
async def aws_eventbridge_webhook(
    request: Request,
    user_id: str = Query(min_length=1, max_length=128, description="Tuff user the events belong to"),
    _: None = Depends(verify_webhook_secret),
    db: Session = Depends(get_db),
):
    """Receive resource-deletion events from AWS EventBridge/SNS.

    Requires the ``X-Tuff-Webhook-Secret`` header and a ``user_id`` so events
    only ever mutate the findings of the account that configured the rule.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be JSON.")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object.")

    try:
        if payload.get("Type") == "SubscriptionConfirmation":
            subscribe_url = payload.get("SubscribeURL")
            if not subscribe_url or not is_trusted_sns_url(subscribe_url):
                # The URL comes straight from the request body, so confirming an
                # arbitrary one would turn this endpoint into an SSRF primitive.
                logger.warning("Refusing SNS confirmation for untrusted URL")
                raise HTTPException(status_code=400, detail="Untrusted SNS confirmation URL.")

            import httpx

            async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
                await client.get(subscribe_url)
            logger.info("Confirmed SNS subscription for user %s", user_id)
            return {"status": "confirmed"}

        message = payload.get("Message")
        event = payload
        if isinstance(message, str):
            try:
                import json

                event = json.loads(message)
            except ValueError:
                event = payload
        elif isinstance(message, dict):
            event = message

        detail = event.get("detail", {}) if isinstance(event, dict) else {}
        event_name = detail.get("eventName", "")
        request_parameters = detail.get("requestParameters", {}) or {}

        deleted_resource_ids = []
        if event_name == "TerminateInstances":
            for inst in request_parameters.get("instancesSet", {}).get("items", []):
                if isinstance(inst, dict) and inst.get("instanceId"):
                    deleted_resource_ids.append(inst["instanceId"])
        elif event_name == "DeleteVolume":
            deleted_resource_ids.append(request_parameters.get("volumeId"))
        elif event_name == "DeleteDBInstance":
            deleted_resource_ids.append(request_parameters.get("dBInstanceIdentifier"))
        elif event_name == "DeleteBucket":
            deleted_resource_ids.append(request_parameters.get("bucketName"))
        elif event_name == "DeleteVpc":
            deleted_resource_ids.append(request_parameters.get("vpcId"))

        deleted_resource_ids = [r for r in deleted_resource_ids if isinstance(r, str) and r]
        if not deleted_resource_ids:
            return {"status": "ignored", "reason": "Not a recognized deletion event"}

        logger.info("Resources %s deleted in AWS; pruning findings for %s", deleted_resource_ids, user_id)

        # Scoped to the owning user: an earlier version scanned the 100 most
        # recent scans across every tenant, letting one caller strip findings
        # out of other users' scan history.
        recent_logs = (
            db.query(InfrastructureLog)
            .filter(InfrastructureLog.user_id == user_id)
            .order_by(desc(InfrastructureLog.timestamp))
            .limit(50)
            .all()
        )

        deleted = set(deleted_resource_ids)
        updated_count = 0
        for log in recent_logs:
            original_findings = log.findings or []
            new_findings = [f for f in original_findings if f.get("id") not in deleted]
            if len(new_findings) != len(original_findings):
                log.findings = new_findings
                log.findings_count = len(new_findings)
                updated_count += 1

        if updated_count:
            db.commit()
            logger.info("Updated %s infrastructure logs from AWS events", updated_count)

        return {"status": "success", "updated_logs": updated_count}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error processing AWS webhook")
        _safe_rollback(db)
        raise HTTPException(status_code=500, detail="Could not process the webhook event.")


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


def _scan_region(access_key: str, secret_key: str, region: str) -> list:
    engine = AWSEngine(aws_access_key=access_key, aws_secret_key=secret_key, region_name=region)
    return engine.execute_full_scan()


@app.post("/api/analyze")
async def analyze_infrastructure(
    request: ScanRequest,
    current_user: dict = Depends(rate_limit(6, 300, "analyze")),
    db: Session = Depends(get_db),
):
    scan_id = str(uuid.uuid4())
    user_id = current_user["uid"]

    if not ai_configured():
        raise HTTPException(status_code=503, detail="AI analysis is not configured on this deployment.")

    access_key, secret_key = _decrypt_aws_credentials(request)

    user_record = _ensure_user(db, user_id)
    user_tier = (user_record.subscription_tier or "free").lower().strip()
    available_credits = user_record.credits or 0

    # Free accounts get a hard budget. Working it out before the scan means the
    # user is told up front instead of the run dying part-way through.
    if user_tier == "free":
        affordable = available_credits // CREDITS_PER_FINDING
        if affordable < 1:
            raise HTTPException(
                status_code=402,
                detail="You have used all your free AI credits. Upgrade to Pro to continue analysing findings.",
            )
    else:
        affordable = MAX_FINDINGS_PER_SCAN

    logger.info(
        "Starting cloud audit region=%s scan=%s tier=%s", request.region, scan_id, user_tier
    )

    try:
        if request.region == "all":
            try:
                import boto3

                ec2_client = boto3.Session(
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key,
                    region_name="us-east-1",
                ).client("ec2")
                regions = [r["RegionName"] for r in ec2_client.describe_regions()["Regions"]]
            except Exception:
                logger.warning("Could not enumerate AWS regions", exc_info=True)
                raise HTTPException(
                    status_code=400,
                    detail="Could not list your AWS regions. Check the credentials and that ec2:DescribeRegions is allowed.",
                )
        else:
            regions = [request.region]

        raw_findings = []
        failed_regions = []
        # Regions are scanned concurrently; sequentially walking ~17 regions
        # regularly exceeded the request timeout.
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=min(MAX_PARALLEL_REGIONS, len(regions))
        ) as executor:
            future_map = {
                executor.submit(_scan_region, access_key, secret_key, reg): reg for reg in regions
            }
            for future in concurrent.futures.as_completed(future_map):
                reg = future_map[future]
                try:
                    raw_findings.extend(future.result())
                except Exception as e:
                    logger.warning("Failed to scan region %s: %s", reg, e)
                    failed_regions.append(reg)

        if failed_regions and len(failed_regions) == len(regions):
            raise HTTPException(
                status_code=400,
                detail="Tuff could not read any of the selected regions. Verify your credentials and IAM permissions.",
            )

        raw_findings = raw_findings[:MAX_FINDINGS_PER_SCAN]
        analyzable = raw_findings[:affordable]
        deferred = raw_findings[affordable:]

        logger.info(
            "Scan %s produced %s findings; analysing %s under '%s' quota",
            scan_id, len(raw_findings), len(analyzable), user_tier,
        )

        def process_finding(finding):
            # No database access here: this runs on a worker thread and the
            # request's SQLAlchemy session is not thread-safe.
            try:
                analysis, cost = explain_finding(finding)
                return finding, analysis, cost, None
            except RuntimeError as e:
                return finding, None, 0, str(e)

        results = []
        if analyzable:
            with concurrent.futures.ThreadPoolExecutor(
                max_workers=min(MAX_PARALLEL_AI_CALLS, len(analyzable))
            ) as executor:
                results = list(executor.map(process_finding, analyzable))

        quota_error = next(
            (
                err
                for _, _, _, err in results
                if err
                and any(
                    marker in err
                    for marker in ("ERROR_QUOTA_EXCEEDED", "ERROR_INSUFFICIENT_FUNDS", "ERROR_SESSION_LIMIT_EXCEEDED")
                )
            ),
            None,
        )
        if quota_error and not any(analysis for _, analysis, _, _ in results):
            # Every AI call failed for the same quota reason: surface it rather
            # than returning an empty, apparently-clean report.
            _log_scan_failure(db, scan_id, user_id, request.region, quota_error)
            if "ERROR_INSUFFICIENT_FUNDS" in quota_error:
                raise HTTPException(status_code=402, detail="AI_BILLING_LIMIT_REACHED")
            raise HTTPException(status_code=429, detail="AI_TOKEN_LIMIT_REACHED")

        ai_evaluated_queue = []
        minimal_findings = []
        credits_used = 0
        degraded = 0

        for finding, analysis, cost, error in results:
            credits_used += cost
            if analysis is None:
                degraded += 1
                analysis = {
                    "explanation": "Automated analysis is temporarily unavailable for this resource.",
                    "business_impact": "Review this resource manually before acting.",
                    "recommended_action": finding.get("recommendation", "Investigate resource configuration."),
                    "priority": finding.get("severity", "medium"),
                    "estimated_savings": finding.get("estimated_monthly_cost", 0),
                }
            ai_evaluated_queue.append(_build_finding_payload(finding, analysis, request.region))
            minimal_findings.append(_build_minimal_finding(finding, analysis))

        for finding in deferred:
            payload = _build_finding_payload(
                finding,
                {
                    "explanation": "Upgrade to Pro to run AI analysis on this finding.",
                    "business_impact": "Not analysed — you have reached your free credit limit.",
                    "recommended_action": finding.get("recommendation", "Investigate resource configuration."),
                    "priority": finding.get("severity", "medium"),
                    "estimated_savings": finding.get("estimated_monthly_cost", 0),
                },
                request.region,
            )
            payload["requires_upgrade"] = True
            ai_evaluated_queue.append(payload)

        _spend_credits(db, user_id, credits_used)

        try:
            db.add(
                InfrastructureLog(
                    scan_id=scan_id,
                    user_id=user_id,
                    region=request.region,
                    findings=minimal_findings,
                    findings_count=len(minimal_findings),
                    status="completed" if not failed_regions else "partial",
                    error_message=(
                        f"Could not scan: {', '.join(failed_regions)}" if failed_regions else None
                    ),
                )
            )
            db.commit()
        except Exception:
            logger.exception("Failed to log scan %s", scan_id)
            _safe_rollback(db)

        db.refresh(user_record)
        return JSONResponse(content={
            "status": "success",
            "data": ai_evaluated_queue,
            "scan_id": scan_id,
            "timestamp": format_datetime(utcnow()),
            "findings_count": len(ai_evaluated_queue),
            "tier_applied": user_tier,
            "credits_remaining": user_record.credits,
            "deferred_count": len(deferred),
            "degraded_count": degraded,
            "failed_regions": failed_regions,
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Core infrastructure analysis failed for scan %s", scan_id)
        _log_scan_failure(db, scan_id, user_id, request.region, str(e))
        raise HTTPException(
            status_code=500,
            detail="The infrastructure scan could not be completed. Please try again.",
        )


def _build_finding_payload(finding: dict, analysis: dict, requested_region: str) -> dict:
    metrics = finding.get("metrics", {}) or {}
    return {
        "uid": finding_uid(finding["resource_id"], finding["issue"]),
        "id": finding["resource_id"],
        "type": f"{finding['issue']} ({finding['resource_type']})",
        "inst": metrics.get("instance_type", finding["resource_type"]),
        "cpu": f"{metrics.get('cpu_avg', 0)}%",
        "region": finding.get("region", requested_region),
        "cur": f"${finding.get('estimated_monthly_cost', 0)}/mo",
        "save": f"${analysis.get('estimated_savings', 0)}/mo",
        "severity": finding.get("severity", "medium"),
        "metrics": metrics,
        "explanation": analysis.get("explanation"),
        "business_impact": analysis.get("business_impact"),
        "recommended_action": analysis.get("recommended_action"),
        "priority": analysis.get("priority", "medium"),
    }


def _build_minimal_finding(finding: dict, analysis: dict) -> dict:
    return {
        "id": finding["resource_id"],
        "uid": finding_uid(finding["resource_id"], finding["issue"]),
        "res_type": finding["resource_type"],
        "issue": finding["issue"],
        "severity": finding["severity"],
        "cost": finding.get("estimated_monthly_cost", 0),
        "save": analysis.get("estimated_savings", 0),
    }


# ---------------------------------------------------------------------------
# Remediation
# ---------------------------------------------------------------------------


@app.post("/api/execute")
async def execute_remediation(
    request: ExecuteRequest,
    current_user: dict = Depends(rate_limit(30, 300, "execute")),
    db: Session = Depends(get_db),
):
    user_id = current_user["uid"]
    # Decrypted here too: previously only /api/analyze decrypted, so every
    # remediation attempt after a page reload sent ciphertext to AWS and failed.
    access_key, secret_key = _decrypt_aws_credentials(request)

    if request.action_type in DESTRUCTIVE_ACTIONS:
        logger.warning(
            "Destructive action requested: user=%s action=%s resource=%s region=%s",
            user_id, request.action_type, request.resource_id, request.region,
        )

    try:
        logger.info(
            "Execution command %s for %s (user %s)", request.action_type, request.resource_id, user_id
        )
        aws_engine = AWSEngine(
            aws_access_key=access_key,
            aws_secret_key=secret_key,
            region_name=request.region,
        )

        resource_id = request.resource_id

        if request.action_type == "stop_instance":
            aws_engine.client("ec2").stop_instances(InstanceIds=[resource_id])
            msg = f"Stopped idle EC2 instance {resource_id}."

        elif request.action_type == "delete_instance":
            aws_engine.client("ec2").terminate_instances(InstanceIds=[resource_id])
            msg = f"Terminated EC2 instance {resource_id}."

        elif request.action_type == "delete_volume":
            aws_engine.client("ec2").delete_volume(VolumeId=resource_id)
            msg = f"Deleted unattached EBS volume {resource_id}."

        elif request.action_type == "delete_vpc":
            aws_engine.client("ec2").delete_vpc(VpcId=resource_id)
            msg = f"Deleted unused VPC {resource_id}."

        elif request.action_type == "stop_rds":
            aws_engine.client("rds").stop_db_instance(DBInstanceIdentifier=resource_id)
            msg = f"Stopped idle RDS instance {resource_id}. Storage is still billed while stopped."

        elif request.action_type == "delete_rds":
            # A final snapshot is taken unconditionally. The previous
            # SkipFinalSnapshot=True destroyed the only copy of the data.
            snapshot_id = f"tuff-final-{resource_id[:30]}-{utcnow().strftime('%Y%m%d%H%M%S')}"
            aws_engine.client("rds").delete_db_instance(
                DBInstanceIdentifier=resource_id,
                SkipFinalSnapshot=False,
                FinalDBSnapshotIdentifier=snapshot_id,
            )
            msg = f"Deleted RDS instance {resource_id} after taking final snapshot {snapshot_id}."

        elif request.action_type == "secure_s3":
            aws_engine.client("s3").put_public_access_block(
                Bucket=resource_id,
                PublicAccessBlockConfiguration={
                    "BlockPublicAcls": True,
                    "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                },
            )
            msg = f"Enabled Public Access Block on S3 bucket {resource_id}."

        elif request.action_type == "scale_instance":
            ec2 = aws_engine.client("ec2")
            # `target_type` is Optional and defaults to None, so falling back
            # with `or` is required; getattr's default never applied because
            # the attribute exists.
            target_type = request.target_type or "t3.micro"
            logger.info("Stopping %s for rightsizing to %s", resource_id, target_type)
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

        else:  # pragma: no cover - the request model already rejects these
            raise HTTPException(status_code=400, detail="Unsupported action.")

        logger.info("Execution successful: %s", msg)

        exec_log = ExecutionLog(
            user_id=user_id,
            resource_id=resource_id,
            action_type=request.action_type,
            result={"status": "success", "message": msg, "timestamp": format_datetime(utcnow())},
            execution_status="success",
        )
        db.add(exec_log)
        db.commit()

        return JSONResponse(content={
            "status": "success",
            "message": msg,
            "timestamp": format_datetime(utcnow()),
            "execution_id": exec_log.id,
        })

    except HTTPException:
        # Validation problems must not be relabelled as pipeline crashes.
        raise
    except Exception as e:
        logger.exception("Execution failed on resource %s", request.resource_id)
        _safe_rollback(db)

        # AWS explains refusals precisely ("UnauthorizedOperation",
        # "VolumeInUse"), which is exactly what the user needs to see, but
        # anything else is kept server-side.
        aws_message = getattr(e, "response", {}).get("Error", {}).get("Message") if hasattr(e, "response") else None
        user_message = aws_message or "The remediation could not be completed. Please check the Logs tab."

        try:
            db.add(
                ExecutionLog(
                    user_id=user_id,
                    resource_id=request.resource_id,
                    action_type=request.action_type,
                    result={"status": "failed", "error": str(e)[:1000], "timestamp": format_datetime(utcnow())},
                    execution_status="failed",
                )
            )
            db.commit()
        except Exception:
            logger.exception("Failed to persist execution failure")
            _safe_rollback(db)

        raise HTTPException(status_code=502, detail=user_message)


# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------


@app.get("/api/logs/infrastructure")
async def get_infrastructure_logs(
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        logs = (
            db.query(InfrastructureLog)
            .filter(InfrastructureLog.user_id == current_user["uid"])
            .order_by(InfrastructureLog.timestamp.desc())
            .limit(limit)
            .all()
        )
        return JSONResponse(content={
            "status": "success",
            "logs": [
                {
                    "scan_id": log.scan_id,
                    "region": log.region,
                    "findings_count": log.findings_count,
                    "status": log.status,
                    "timestamp": format_datetime(log.timestamp),
                    "error": log.error_message,
                }
                for log in logs
            ],
        })
    except Exception:
        logger.exception("Failed to retrieve infrastructure logs")
        raise HTTPException(status_code=500, detail="Could not load scan history.")


@app.get("/api/logs/infrastructure/{scan_id}")
async def get_scan_details(
    scan_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        log = (
            db.query(InfrastructureLog)
            .filter(
                InfrastructureLog.scan_id == scan_id,
                InfrastructureLog.user_id == current_user["uid"],
            )
            .first()
        )
        if not log:
            raise HTTPException(status_code=404, detail="Scan not found.")

        return JSONResponse(content={
            "status": "success",
            "scan": {
                "scan_id": log.scan_id,
                "region": log.region,
                "findings_count": log.findings_count,
                "findings": log.findings,
                "status": log.status,
                "timestamp": format_datetime(log.timestamp),
            },
        })
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to retrieve scan details")
        raise HTTPException(status_code=500, detail="Could not load that scan.")


@app.get("/api/logs/execution")
async def get_execution_logs(
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        logs = (
            db.query(ExecutionLog)
            .filter(ExecutionLog.user_id == current_user["uid"])
            .order_by(ExecutionLog.timestamp.desc())
            .limit(limit)
            .all()
        )
        return JSONResponse(content={
            "status": "success",
            "logs": [
                {
                    "id": log.id,
                    "resource_id": log.resource_id,
                    "action_type": log.action_type,
                    "status": log.execution_status,
                    "result": log.result,
                    "timestamp": format_datetime(log.timestamp),
                }
                for log in logs
            ],
        })
    except Exception:
        logger.exception("Failed to retrieve execution logs")
        raise HTTPException(status_code=500, detail="Could not load execution history.")


# ---------------------------------------------------------------------------
# IAM policy
# ---------------------------------------------------------------------------


@app.post("/api/generate-iam-policy")
async def generate_iam_policy(current_user: dict = Depends(get_current_user)):
    logger.info("Serving IAM policy to %s", current_user["uid"])
    static_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "TUFFReadOnlyAccess",
                "Effect": "Allow",
                "Action": [
                    "ec2:DescribeInstances",
                    "ec2:DescribeRegions",
                    "ec2:DescribeVolumes",
                    "ec2:DescribeVpcs",
                    "ec2:DescribeNetworkInterfaces",
                    "ec2:DescribeNatGateways",
                    "rds:DescribeDBInstances",
                    "s3:ListAllMyBuckets",
                    "s3:GetBucketPublicAccessBlock",
                    "cloudwatch:GetMetricStatistics",
                    "cloudwatch:ListMetrics",
                    "autoscaling:DescribeAutoScalingGroups",
                    "autoscaling:DescribeAutoScalingInstances"
                ],
                "Resource": "*"
            },
            {
                "Sid": "TUFFRemediationAccess",
                "Effect": "Allow",
                "Action": [
                    "ec2:StopInstances",
                    "ec2:StartInstances",
                    "ec2:TerminateInstances",
                    "ec2:DeleteVolume",
                    "ec2:DeleteVpc",
                    "ec2:ModifyInstanceAttribute",
                    "rds:StopDBInstance",
                    "rds:DeleteDBInstance",
                    "rds:CreateDBSnapshot",
                    "s3:PutBucketPublicAccessBlock"
                ],
                "Resource": [
                    "arn:aws:ec2:*:*:instance/*",
                    "arn:aws:ec2:*:*:volume/*",
                    "arn:aws:ec2:*:*:vpc/*",
                    "arn:aws:rds:*:*:db:*",
                    "arn:aws:rds:*:*:snapshot:*",
                    "arn:aws:s3:::*"
                ]
            },
            {
                "Sid": "TUFFAutoScalingRemediationAccess",
                "Effect": "Allow",
                "Action": [
                    "autoscaling:SetDesiredCapacity",
                    "autoscaling:TerminateInstanceInAutoScalingGroup",
                    "autoscaling:UpdateAutoScalingGroup",
                    "autoscaling:SuspendProcesses",
                    "autoscaling:ResumeProcesses"
                ],
                "Resource": [
                    "arn:aws:autoscaling:*:*:autoScalingGroup:*:autoScalingGroupName/*"
                ]
            },
            {
                "Sid": "TUFFEventBridgeAccess",
                "Effect": "Allow",
                "Action": [
                    "events:PutRule",
                    "events:PutTargets",
                    "sns:CreateTopic",
                    "sns:Subscribe"
                ],
                "Resource": [
                    "arn:aws:events:*:*:rule/*",
                    "arn:aws:sns:*:*:*"
                ]
            }
        ]
    }
    return JSONResponse(content={
        "status": "success",
        "policy": static_policy,
        "timestamp": format_datetime(utcnow()),
        "description": "IAM permissions required for TUFF scanning and remediation",
        "note": (
            "Scanning only needs the TUFFReadOnlyAccess statement. Remove the other "
            "statements if you never want Tuff to be able to change your infrastructure."
        ),
    })


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


@app.post("/api/alerts/config")
async def create_alert_config(
    request: AlertConfigRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user["uid"]
    try:
        active_count = (
            db.query(AlertConfig)
            .filter(AlertConfig.user_id == user_id, AlertConfig.active == True)  # noqa: E712
            .count()
        )
        if active_count >= 50:
            raise HTTPException(status_code=400, detail="You have reached the limit of 50 active alerts.")

        alert_config = AlertConfig(
            id=str(uuid.uuid4()),
            user_id=user_id,
            resource_type=request.resourceType,
            metric=request.metric,
            threshold=request.threshold,
            threshold_type=request.thresholdType,
            active=True,
        )
        db.add(alert_config)
        db.commit()
        db.refresh(alert_config)
        logger.info("Alert config created for %s: %s", user_id, alert_config.id)
        return JSONResponse(content={
            "status": "success",
            "alert": {
                "id": alert_config.id,
                "resourceType": alert_config.resource_type,
                "metric": alert_config.metric,
                "threshold": alert_config.threshold,
                "thresholdType": alert_config.threshold_type,
                "created_at": format_datetime(alert_config.created_at),
            },
        })
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to create alert config")
        _safe_rollback(db)
        raise HTTPException(status_code=500, detail="Could not save the alert.")


@app.get("/api/alerts/config")
async def get_alert_configs(
    current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)
):
    try:
        configs = (
            db.query(AlertConfig)
            .filter(AlertConfig.active == True, AlertConfig.user_id == current_user["uid"])  # noqa: E712
            .order_by(AlertConfig.created_at.desc())
            .all()
        )
        return JSONResponse(content={
            "status": "success",
            "configs": [
                {
                    "id": c.id,
                    "resourceType": c.resource_type,
                    "metric": c.metric,
                    "threshold": c.threshold,
                    "thresholdType": c.threshold_type,
                    "created_at": format_datetime(c.created_at),
                }
                for c in configs
            ],
        })
    except Exception:
        logger.exception("Failed to retrieve alert configs")
        raise HTTPException(status_code=500, detail="Could not load your alerts.")


@app.delete("/api/alerts/config/{config_id}")
async def delete_alert_config(
    config_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        config = (
            db.query(AlertConfig)
            .filter(AlertConfig.id == config_id, AlertConfig.user_id == current_user["uid"])
            .first()
        )
        if not config:
            raise HTTPException(status_code=404, detail="Alert not found.")

        config.active = False
        db.commit()
        logger.info("Alert config deactivated: %s", config_id)
        return JSONResponse(content={"status": "success", "message": "Alert removed."})
    except HTTPException:
        # Without this the 404 above was caught below and reported as a 500.
        raise
    except Exception:
        logger.exception("Failed to delete alert config")
        _safe_rollback(db)
        raise HTTPException(status_code=500, detail="Could not remove the alert.")


@app.post("/api/alerts/evaluate")
async def evaluate_alerts(
    request: AlertEvaluateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user["uid"]
    try:
        # Alert definitions are read from the database rather than accepted from
        # the request, so a caller cannot evaluate against thresholds or config
        # ids that do not belong to them.
        configs = (
            db.query(AlertConfig)
            .filter(AlertConfig.user_id == user_id, AlertConfig.active == True)  # noqa: E712
            .all()
        )
        if not configs:
            return JSONResponse(content={"status": "success", "alerts": []})

        dedupe_window_start = utcnow() - timedelta(hours=1)
        recent_keys = {
            (row.config_id, row.resource_id)
            for row in db.query(TriggeredAlert.config_id, TriggeredAlert.resource_id)
            .filter(
                TriggeredAlert.user_id == user_id,
                TriggeredAlert.timestamp >= dedupe_window_start,
            )
            .all()
        }

        triggered_alerts = []
        for config in configs:
            for finding in request.findings:
                if not isinstance(finding, dict):
                    continue

                resource_id = finding.get("id")
                finding_type = finding.get("type") or ""
                if not resource_id or config.resource_type not in finding_type:
                    continue

                metric_value = _parse_metric(finding.get(config.metric))
                if metric_value is None:
                    continue

                if config.threshold_type == "below":
                    triggered = metric_value < config.threshold
                else:
                    triggered = metric_value > config.threshold
                if not triggered:
                    continue

                key = (config.id, resource_id)
                if key in recent_keys:
                    # The dashboard re-evaluates whenever findings change; without
                    # this the history filled up with copies of the same alert.
                    continue
                recent_keys.add(key)

                record = TriggeredAlert(
                    user_id=user_id,
                    config_id=config.id,
                    resource_id=resource_id,
                    resource_type=finding_type,
                    metric=config.metric,
                    value=metric_value,
                    threshold=config.threshold,
                    condition=config.threshold_type,
                )
                db.add(record)
                triggered_alerts.append(record)

        db.commit()
        logger.info("Alert evaluation for %s: %s new alerts", user_id, len(triggered_alerts))
        return JSONResponse(content={
            "status": "success",
            "alerts": [
                {
                    "id": record.id,
                    "configId": record.config_id,
                    "resourceId": record.resource_id,
                    "resourceType": record.resource_type,
                    "metric": record.metric,
                    "value": record.value,
                    "threshold": record.threshold,
                    "condition": record.condition,
                    "timestamp": format_datetime(record.timestamp),
                }
                for record in triggered_alerts
            ],
        })
    except Exception:
        logger.exception("Failed to evaluate alerts")
        _safe_rollback(db)
        raise HTTPException(status_code=500, detail="Could not evaluate your alerts.")


@app.get("/api/alerts/triggered")
async def get_triggered_alerts(
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        alerts = (
            db.query(TriggeredAlert)
            .filter(TriggeredAlert.user_id == current_user["uid"])
            .order_by(TriggeredAlert.timestamp.desc())
            .limit(limit)
            .all()
        )
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
                    "timestamp": format_datetime(alert.timestamp),
                }
                for alert in alerts
            ],
        })
    except Exception:
        logger.exception("Failed to retrieve triggered alerts")
        raise HTTPException(status_code=500, detail="Could not load alert history.")


# ---------------------------------------------------------------------------
# AI helpers & action log
# ---------------------------------------------------------------------------


@app.post("/api/humanize")
async def humanize(
    request: HumanizeRequest, current_user: dict = Depends(rate_limit(30, 300, "humanize"))
):
    try:
        humanized_text = humanize_insight(
            request.explanation, request.business_impact, request.recommended_action
        )
        return JSONResponse(content={"status": "success", "humanized_text": humanized_text})
    except Exception:
        logger.exception("Failed to humanize insight")
        raise HTTPException(status_code=502, detail="Could not generate a plain-English summary.")


@app.post("/api/action-logs")
async def save_action_log(
    request: ActionLogRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user["uid"]
    try:
        log_id = str(uuid.uuid4())
        db.add(
            ActionLog(
                id=log_id,
                user_id=user_id,
                resource_id=request.resource_id,
                action=request.action,
                resource_type=request.resource_type,
            )
        )
        db.commit()
        return JSONResponse(content={
            "status": "success",
            "log_id": log_id,
            "timestamp": format_datetime(utcnow()),
        })
    except Exception:
        logger.exception("Failed to save action log")
        _safe_rollback(db)
        raise HTTPException(status_code=500, detail="Could not record that action.")


@app.get("/api/action-logs")
async def get_action_logs(
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        logs = (
            db.query(ActionLog)
            .filter(ActionLog.user_id == current_user["uid"])
            .order_by(ActionLog.timestamp.desc())
            .limit(limit)
            .all()
        )
        return JSONResponse(content={
            "status": "success",
            "logs": [
                {
                    "id": log.id,
                    "resource_id": log.resource_id,
                    "action": log.action,
                    "type": log.resource_type,
                    "timestamp": format_datetime(log.timestamp),
                }
                for log in logs
            ],
        })
    except Exception:
        logger.exception("Failed to retrieve action logs")
        raise HTTPException(status_code=500, detail="Could not load your action history.")


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "TUFF Backend",
        "version": "1.0.0",
        "ai_configured": ai_configured(),
        "payments_configured": PAYMENTS_ENABLED,
    }


@app.get("/")
async def root():
    return {
        "message": "TUFF Backend API",
        "health": "/api/health",
        "main_endpoint": "/api/analyze",
    }


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host=os.getenv("BACKEND_HOST", "127.0.0.1"),
        port=int(os.getenv("BACKEND_PORT", "8000")),
        reload=not IS_PRODUCTION,
    )
