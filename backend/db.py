from sqlalchemy import create_engine, Column, String, Float, DateTime, JSON, Integer, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set. Please configure it in .env file.")

engine = create_engine(
    DATABASE_URL, 
    echo=False, 
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=1800
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class UserSubscription(Base):
    __tablename__ = "user_subscriptions"
    
    user_id = Column(String, primary_key=True, index=True)
    subscription_tier = Column(String, default="free", nullable=False)  
    stripe_customer_id = Column(String, nullable=True)                  
    subscription_id = Column(String, nullable=True)                     
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)


class AlertConfig(Base):
    __tablename__ = "alert_configs"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)  
    resource_type = Column(String, nullable=False)
    metric = Column(String, nullable=False)
    threshold = Column(Float, nullable=False)
    threshold_type = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
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
    timestamp = Column(DateTime, default=datetime.utcnow)


class InfrastructureLog(Base):
    __tablename__ = "infrastructure_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(String, nullable=False, unique=True, index=True)
    region = Column(String, nullable=False)
    findings = Column(JSON, nullable=False)
    findings_count = Column(Integer, default=0)
    timestamp = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="completed")
    error_message = Column(String, nullable=True)


class ExecutionLog(Base):
    __tablename__ = "execution_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, index=True)
    resource_id = Column(String, nullable=False)
    action_type = Column(String, nullable=False)
    result = Column(JSON, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
    execution_status = Column(String, default="success")


class ActionLog(Base):
    __tablename__ = "action_logs"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    resource_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    resource_type = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()