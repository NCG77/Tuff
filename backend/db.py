from sqlalchemy import create_engine, Column, String, Float, DateTime, JSON, Integer, Boolean, Index
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timezone
import os
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, ".env.local"))
load_dotenv(os.path.join(_HERE, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set. Please configure it in .env.local or .env.")

_connect_args = {}
_engine_kwargs = {
    "echo": False,
    "pool_pre_ping": True,
}

if DATABASE_URL.startswith("sqlite"):
    # SQLite is fine for local preview; FastAPI serves requests from worker
    # threads, so check_same_thread must be disabled. Connection pooling
    # knobs below are Postgres-specific and are skipped here.
    _connect_args["check_same_thread"] = False
else:
    _engine_kwargs.update(
        {
            "pool_size": 5,
            "max_overflow": 10,
            "pool_recycle": 1800,
        }
    )

engine = create_engine(DATABASE_URL, connect_args=_connect_args, **_engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def utcnow() -> datetime:
    """Current UTC time as a naive datetime.

    The timestamp columns below are ``TIMESTAMP WITHOUT TIME ZONE``, so values
    must be naive to avoid the driver silently converting them. Everything
    stored is UTC; ``format_datetime`` in app.py re-attaches the zone on the
    way out so clients don't misread the value as local time.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


class UserSubscription(Base):
    __tablename__ = "user_subscriptions"
    
    user_id = Column(String, primary_key=True, index=True)
    subscription_tier = Column(String, default="free", nullable=False)  
    razorpay_customer_id = Column(String, nullable=True)                  
    razorpay_subscription_id = Column(String, nullable=True)
    credits = Column(Integer, default=1000, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    created_at = Column(DateTime, default=utcnow)


class PaymentOrder(Base):
    """Server-side record of every Razorpay order Tuff creates.

    Verification is checked against this table so that a payment can only ever
    be redeemed once, and only by the user the order was created for. Without
    it, a valid signature could be replayed indefinitely for free credits.
    """

    __tablename__ = "payment_orders"

    order_id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    plan = Column(String, nullable=False)
    amount = Column(Integer, nullable=False)
    currency = Column(String, nullable=False, default="INR")
    status = Column(String, nullable=False, default="created")  # created | paid | failed
    payment_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class AlertConfig(Base):
    __tablename__ = "alert_configs"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)  
    resource_type = Column(String, nullable=False)
    metric = Column(String, nullable=False)
    threshold = Column(Float, nullable=False)
    threshold_type = Column(String, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    active = Column(Boolean, default=True)


class TriggeredAlert(Base):
    __tablename__ = "triggered_alerts"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, index=True)
    config_id = Column(String, nullable=False)
    resource_id = Column(String, nullable=False)
    resource_type = Column(String, nullable=False)
    metric = Column(String, nullable=False)
    value = Column(Float, nullable=False)
    threshold = Column(Float, nullable=False)
    condition = Column(String, nullable=False)
    timestamp = Column(DateTime, default=utcnow)

    # Supports the "was this exact alert already recorded recently?" lookup that
    # keeps repeated evaluations from filling the history with duplicates.
    __table_args__ = (
        Index("ix_triggered_alerts_dedupe", "user_id", "config_id", "resource_id", "timestamp"),
    )

class InfrastructureLog(Base):
    __tablename__ = "infrastructure_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(String, nullable=False, unique=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    region = Column(String, nullable=False)
    findings = Column(JSON, nullable=False)
    findings_count = Column(Integer, default=0)
    timestamp = Column(DateTime, default=utcnow)
    status = Column(String, default="completed")
    error_message = Column(String, nullable=True)



class ExecutionLog(Base):
    __tablename__ = "execution_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, index=True)
    resource_id = Column(String, nullable=False)
    action_type = Column(String, nullable=False)
    result = Column(JSON, nullable=False)
    timestamp = Column(DateTime, default=utcnow)
    execution_status = Column(String, default="success")


class ActionLog(Base):
    __tablename__ = "action_logs"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    resource_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    resource_type = Column(String, nullable=False)
    timestamp = Column(DateTime, default=utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
