from fastapi import APIRouter, HTTPException
from typing import Dict, Any

router = APIRouter(prefix="/workflows", tags=["workflows"])

# In-memory mock storage
WORKFLOWS_DB: Dict[str, Any] = {}

@router.post("")
async def save_workflow(payload: Dict[str, Any]):
    # Provide a simple mock save
    workflow_id = "default"
    WORKFLOWS_DB[workflow_id] = payload
    return {"ok": True, "id": workflow_id}

@router.get("/{workflow_id}")
async def load_workflow(workflow_id: str):
    if workflow_id not in WORKFLOWS_DB:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"ok": True, "data": WORKFLOWS_DB[workflow_id]}
