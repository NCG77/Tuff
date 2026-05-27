from fastapi import FastAPI
from fastapi.responses import JSONResponse
import logging
import uvicorn
from ai_insights import explain_finding

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TUFF Backend API",
    description="Cloud Infrastructure Analysis Engine",
    version="1.0.0"
)


@app.get("/api/analyze")
async def analyze_finding(finding: dict):
    try:
        logger.info(f"Analyzing finding: {finding}")
        result = explain_finding(finding)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Analysis failed: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Analysis failed: {str(e)}"}
        )


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "TUFF Backend",
        "version": "1.0.0"
    }


@app.get("/")
async def root():
    return {
        "message": "TUFF Backend API",
        "docs": "/docs",
        "health": "/api/health",
        "main_endpoint": "/api/analyze"
    }


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )