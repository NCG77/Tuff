# Tuff - Cloud Infrastructure Analysis Engine

A production-ready cloud resource analyzer that helps optimize AWS infrastructure, reduce costs, and improve security.

## Quick Start

1. **Clone repository**
   ```bash
   git clone <repo>
   cd Tuff
   ```

2. **Setup Frontend**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your Firebase credentials and API URL
   npm install
   npm run dev
   ```

3. **Setup Backend**
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with your database and API keys
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   uvicorn app:app --reload
   ```

4. **Access the app**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000

## Environment Configuration

### Frontend (.env.local)
```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_key
NEXT_PUBLIC_API_URL=http://localhost:8000  # or your production API URL
```

### Backend (.env)
```env
DATABASE_URL=postgresql://...
OpenRouter_API_KEY=your_key
ENVIRONMENT=development
FRONTEND_URL=http://localhost:3000
```

**See [SETUP.md](SETUP.md) for detailed setup and deployment instructions.**

## Features

- 🔍 Cloud resource scanning and analysis
- 💰 Cost optimization recommendations
- 🔐 Security findings and recommendations
- 📊 Real-time monitoring and alerts
- 📝 Action history and audit logs
- ⚡ AWS integration with IAM policy generation

## Tech Stack

### Frontend
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Firebase Authentication

### Backend
- FastAPI (Python)
- PostgreSQL
- SQLAlchemy ORM
- AWS SDK (Boto3)
- Groq AI

## Project Structure

```
.
├── app/                    # Frontend Next.js app
│   ├── components/        # React components
│   ├── context/          # Auth context
│   ├── lib/              # Utilities and config
│   └── src/              # Page routes
├── backend/              # Backend FastAPI server
│   ├── app.py           # Main API server
│   ├── aws_engine.py    # AWS interaction logic
│   ├── db.py            # Database models
│   ├── ai_insights.py   # AI analysis engine
│   └── requirements.txt  # Python dependencies
├── public/              # Static assets
├── vercel.json          # Frontend deployment config
└── SETUP.md             # Setup and deployment guide
```

## Production Deployment

See [SETUP.md](SETUP.md) for comprehensive deployment instructions including:
- Environment-specific configuration
- Docker setup
- Vercel deployment
- Security checklist
- Troubleshooting guide

## Key Updates

- ✅ All hardcoded backend URLs replaced with environment variables
- ✅ Centralized API configuration in `app/lib/config.ts`
- ✅ Production-ready Next.js configuration with security headers
- ✅ Backend CORS configuration via environment variables
- ✅ Development logging wrapped for production safety
- ✅ Example environment files for both frontend and backend

## Security

- Environment variables required for all sensitive data
- No hardcoded URLs or API keys
- CORS configured based on environment
- Security headers enabled in production
- Debug logging disabled in production

## License

Proprietary - See LICENSE file 
