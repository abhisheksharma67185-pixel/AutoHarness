from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.v1.deps import get_db
from app.domain.models import RunTask, TraceStep, FailureLabel

router = APIRouter(prefix="/tasks", tags=["tasks"])

class OverrideTaxonomyRequest(BaseModel):
    run_task_id: str
    taxonomy_label: str

@router.post("/override")
def override_task_taxonomy(payload: OverrideTaxonomyRequest, db: Session = Depends(get_db)):
    run_task = db.query(RunTask).filter(RunTask.id == payload.run_task_id).first()
    if not run_task:
        raise HTTPException(status_code=404, detail="Run task does not exist")

    # Map incoming tag
    mapped_taxonomy = "OTHER"
    clean_taxonomy = (payload.taxonomy_label or "").upper()
    valid_taxonomies = {'GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER'}
    if clean_taxonomy in valid_taxonomies:
        mapped_taxonomy = clean_taxonomy
    elif clean_taxonomy == 'SAFETY_VIOLATION':
        mapped_taxonomy = 'SAFETY'

    # UPSERT failure label
    fl = db.query(FailureLabel).filter(FailureLabel.run_task_id == payload.run_task_id).first()
    if fl:
        fl.taxonomy_primary = mapped_taxonomy
        fl.source = "MANUAL"
    else:
        fl = FailureLabel(
            run_task_id=payload.run_task_id,
            run_id=run_task.run_id,
            is_failure=True,
            source="MANUAL",
            taxonomy_primary=mapped_taxonomy,
            diagnosis_text="Manually updated by user.",
            raw_judge={}
        )
        db.add(fl)

    db.commit()
    return {"success": True, "message": "Taxonomy label overridden successfully."}

@router.get("/{run_task_id}")
def get_task_detail(run_task_id: str, db: Session = Depends(get_db)):
    task = db.query(RunTask).filter(RunTask.id == run_task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    fl = db.query(FailureLabel).filter(FailureLabel.run_task_id == run_task_id).first()
    desc = task.raw_task.get("description", "") if task.raw_task else ""
    
    return {
        "data": {
            "id": task.id,
            "run_id": task.run_id,
            "status": task.status,
            "score": task.score,
            "task_id": task.benchmark_task_id,
            "slug": task.task_slug,
            "category": task.category,
            "difficulty": task.difficulty,
            "description": desc,
            "diagnosis_text": fl.diagnosis_text if fl else None,
            "taxonomy_label": fl.taxonomy_primary if fl else None,
            "failure_label_id": fl.id if fl else None
        },
        "error": None
    }

@router.get("/{run_task_id}/trace")
def get_task_trace(run_task_id: str, db: Session = Depends(get_db)):
    task = db.query(RunTask).filter(RunTask.id == run_task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    steps = (
        db.query(TraceStep)
        .filter(TraceStep.run_task_id == run_task_id)
        .order_by(TraceStep.step_index)
        .all()
    )
    serialized_steps = [
        {
            "id": s.id,
            "run_task_id": s.run_task_id,
            "step_index": s.step_index,
            "step_type": s.step_type,
            "content": s.content,
            "metadata": s.metadata_json
        }
        for s in steps
    ]
    return {"data": {"run_task_id": run_task_id, "steps": serialized_steps}, "error": None}
