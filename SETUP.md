# Production Setup Guide

## Overview
This guide explains how to set up the TUFF project for both development and production environments.

## Project Structure
- **Frontend**: Next.js application in the root directory
- **Backend**: FastAPI Python application in the `backend/` directory

## Prerequisites
- Node.js 18+
- Python 3.9+
- PostgreSQL database (via Neon or local)
- AWS Account with appropriate permissions

## Frontend Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the root directory using `.env.example` as a template:

```bash
# Copy the example
cp .env.example .env.local

# Edit with your values
```

**Required Variables:**
- `NEXT_PUBLIC_FIREBASE_API_KEY` - Firebase authentication
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` - Firebase project ID
- `NEXT_PUBLIC_API_URL` - Backend API URL (default: http://localhost:8000)

### 3. Development
```bash
npm run dev
```
Access at: http://localhost:3000

### 4. Production Build
```bash
npm run build
npm start
```

## Backend Setup

### 1. Create Virtual Environment
```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Create `.env` file in the `backend/` directory using `.env.example` as a template:

```bash
# Copy the example
cp .env.example .env

# Edit with your values
```

**Required Variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `OpenRouter_API_KEY` - OpenRouter API key for AI insights
- `BACKEND_HOST` - Server host (default: 0.0.0.0)
- `BACKEND_PORT` - Server port (default: 8000)
- `ENVIRONMENT` - Environment name (development/production)
- `FRONTEND_URL` - Frontend URL for CORS

### 4. Development
```bash
uvicorn app:app --reload
```
Access at: http://localhost:8000

### 5. Production
```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 4
```

## Environment-Specific Configuration

### Development
```env
# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000

# Backend
ENVIRONMENT=development
FRONTEND_URL=http://localhost:3000
```

### Production
```env
# Frontend
NEXT_PUBLIC_API_URL=https://api.yourdomain.com

# Backend
ENVIRONMENT=production
FRONTEND_URL=https://yourdomain.com
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
```

## Database Setup

### Neon (PostgreSQL)
1. Create account at https://neon.tech
2. Create a project and database
3. Copy the connection string to `DATABASE_URL` in `.env`

### Local PostgreSQL
```bash
# Create database
createdb tuff

# Set connection string
DATABASE_URL=postgresql://user:password@localhost:5432/tuff
```

## Deployment

### Vercel (Recommended for Frontend)
1. Push your code to GitHub
2. Connect your repository to Vercel
3. Add environment variables in Vercel settings
4. Deploy

### Docker

#### Frontend
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

#### Backend
```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```

## API Configuration

All API calls use centralized configuration in `app/lib/config.ts`. To change the backend URL:

1. Update `NEXT_PUBLIC_API_URL` environment variable
2. The app will automatically use it for all API calls

No hardcoded URLs in component code!

## Security Checklist

- [ ] Environment variables are not committed to git
- [ ] `.env.local` and `backend/.env` are in `.gitignore`
- [ ] Use `.env.example` files as templates
- [ ] Rotate API keys and secrets regularly
- [ ] Use HTTPS in production
- [ ] Enable CORS only for trusted domains in production
- [ ] Validate all user inputs on backend
- [ ] Use environment-appropriate logging (disabled in production)

## Troubleshooting

### Frontend cannot connect to backend
- Check `NEXT_PUBLIC_API_URL` is correct
- Ensure backend is running
- Check browser console for CORS errors
- Verify firewall allows connections

### Backend database connection fails
- Verify `DATABASE_URL` is correct
- Ensure database server is running
- Check network connectivity
- Verify credentials

### Environment variables not loading
- Clear build cache: `npm run build` (frontend) or restart server (backend)
- Verify variable names start with `NEXT_PUBLIC_` in frontend
- Check `.env` file exists and has correct format

## Additional Resources

- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/)
- [Vercel Configuration](https://vercel.com/docs)
- [Environment Variables Best Practices](https://12factor.net/config)
