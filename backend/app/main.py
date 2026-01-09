"""
FastAPI application entry point for Mail Manager.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import init_db
from app.utils.logging_config import setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and logging on startup."""
    # Setup logging
    setup_logging(log_level="INFO", log_to_file=True)
    
    # Initialize database
    await init_db()
    yield


app = FastAPI(
    title="Mail Manager API",
    description="Local email management with AI classification",
    version="0.1.0",
    lifespan=lifespan
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "tauri://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "Mail Manager API",
        "version": "0.1.0"
    }


@app.get("/health")
async def health():
    """Detailed health check."""
    return {
        "status": "healthy",
        "database": "connected",
        "ollama": "not_checked"  # TODO: Check Ollama connection
    }


# Import routers
from app.routers import accounts, messages, sync, attachments, classify, whitelist, send

app.include_router(accounts.router, prefix="/api/accounts", tags=["accounts"])
app.include_router(messages.router, prefix="/api/messages", tags=["messages"])
app.include_router(sync.router, prefix="/api/sync", tags=["sync"])
app.include_router(attachments.router, prefix="/api/attachments", tags=["attachments"])
app.include_router(classify.router, prefix="/api/classify", tags=["classify"])
app.include_router(whitelist.router, prefix="/api/whitelist", tags=["whitelist"])
app.include_router(send.router, prefix="/api/send", tags=["send"])

