# Tuff 🛡️

> **Cloud Infrastructure Analysis Engine**

<img width="1000" height="500" alt="EDIT-Screenshot 2026-06-05 174329" src="https://github.com/user-attachments/assets/b9cf7831-7ef8-4775-a152-8138d8f6f6fb" />

Tuff is a production-ready analyzer that connects to your AWS environment to optimize resources, slash costs, and harden security using AI-driven insights.

## Features

- **Automated Audits:** Scan and analyze cloud resources instantly.
- **Cost Optimization:** Identify unused resources and eliminate waste.
- **Security Hardening:** Detect vulnerabilities and automatically generate IAM policies.
- **AI Insights:** Get intelligent explanations and actionable remediation steps.
- **Real-Time Monitoring:** Active alerting backed by complete audit logs.

## 🚀 Quick Start

### 1. Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # Configure your DB & API keys
uvicorn app:app --reload
```

### 2. Frontend Setup
```bash
cp .env.example .env.local # Configure Firebase credentials
npm install
npm run dev
```
*Frontend runs on `http://localhost:3000` | Backend API runs on `http://localhost:8000`*

## 🛠️ Tech Stack

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS, Firebase Auth
- **Backend:** Python, FastAPI, PostgreSQL, SQLAlchemy
- **Integrations:** AWS SDK (Boto3), Razorpay, AI (OpenAI)

## Documentation

For comprehensive instructions on production deployment, environment configurations, and Docker setup, please refer to the detailed [SETUP.md](SETUP.md).

---
*Proprietary License - See [LICENSE](LICENSE) for details.*
