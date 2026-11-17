from fastapi import FastAPI
from dotenv import load_dotenv
from app.api.routes import router

# Load environment variables
load_dotenv()

# Create FastAPI app
app = FastAPI(title="QuickFix AI Service", version="1.0.0")

# Register routes
app.include_router(router)

@app.get("/")
async def root():
    return {"service": "ai-service", "status": "ok"}

@app.get("/health")
async def health():
    return {"service": "ai-service", "status": "ok", "model_loading": "on-demand"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=True)
