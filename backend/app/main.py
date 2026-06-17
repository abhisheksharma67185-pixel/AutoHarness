from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.settings import get_settings
from app.core.logging import setup_logging
from app.api.v1 import runs, tasks, jobs, evals, experiments
from app.api.routes import database, http_request, pipelines, ollama, workflows, workflow_triggers, approvals
from app.db.base import Base
from app.db.session import engine

# Setup logging
setup_logging()

# Create tables if they do not exist (idempotent)
Base.metadata.create_all(bind=engine)

settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

# API v1
from fastapi import APIRouter
api_router = APIRouter(prefix=settings.api_v1_prefix)
api_router.include_router(runs.router)
api_router.include_router(runs.failure_modes_router)
api_router.include_router(tasks.router)
api_router.include_router(jobs.router)
api_router.include_router(evals.router_suites)
api_router.include_router(evals.router_runs)
api_router.include_router(experiments.router)
api_router.include_router(pipelines.router)
api_router.include_router(ollama.router)
api_router.include_router(workflows.router)
api_router.include_router(database.router)
api_router.include_router(http_request.router)
api_router.include_router(workflow_triggers.router)
api_router.include_router(approvals.router)
app.include_router(api_router)
