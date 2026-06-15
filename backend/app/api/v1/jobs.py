import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.deps import get_db
from app.domain.models import Job, Run
from app.jobs.harbor_rerun import run_harbor_job
from app.jobs.diagnose_run import diagnose_run
from app.jobs import run_cluster_job

router = APIRouter(prefix="/jobs", tags=["jobs"])

class HarborRerunRequest(BaseModel):
    agent_name: str
    config_path: str | None = None

class DiagnoseRequest(BaseModel):
    run_id: str

@router.post("/harbor-rerun", status_code=202)
def create_harbor_rerun_job(payload: HarborRerunRequest, db: Session = Depends(get_db)):
    job_id = str(uuid.uuid4())
    job = Job(
        id=job_id,
        type="harbor_rerun",
        status="pending",
        progress=0.0,
        payload=payload.dict(),
        created_at=datetime.utcnow()
    )
    db.add(job)
    db.commit()

    try:
        job.status = "running"
        job.progress = 10.0
        db.commit()
        run = run_harbor_job(db, payload.agent_name, payload.config_path)
        job.status = "completed"
        job.progress = 100.0
        job.finished_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Harbor rerun failed: {e}")

    return {"data": {"job_id": job_id, "run_id": run.id}, "error": None}

@router.post("/diagnose-failures")
def create_diagnose_job(payload: DiagnoseRequest, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == payload.run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    job_id = str(uuid.uuid4())
    job = Job(
        id=job_id,
        type="diagnose_failures",
        status="pending",
        progress=0.0,
        payload=payload.dict(),
        created_at=datetime.utcnow()
    )
    db.add(job)
    db.commit()

    try:
        job.status = "running"
        job.progress = 10.0
        db.commit()
        n = diagnose_run(db, payload.run_id)
        job.status = "completed"
        job.progress = 100.0
        job.finished_at = datetime.utcnow()
        new_payload = dict(job.payload or {})
        new_payload["diagnosed"] = n
        job.payload = new_payload
        db.commit()
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Diagnosis failed: {e}")

    return {"data": {"job_id": job_id, "diagnosed": n}, "error": None}

from app.jobs.embed_failure_labels import embed_failure_labels
from app.jobs.cluster_modes import cluster_failure_modes, run_cluster_job

class EmbedFailureLabelsRequest(BaseModel):
    benchmark_slug: str
    run_ids: list[str] | None = None
    embedding_model: str | None = None

@router.post("/embed-failure-labels", status_code=202)
def create_embed_failure_labels_job(payload: EmbedFailureLabelsRequest, db: Session = Depends(get_db)):
    job_id = str(uuid.uuid4())
    job = Job(
        id=job_id,
        type="embed_failure_labels",
        status="pending",
        progress=0.0,
        payload=payload.dict(),
        created_at=datetime.utcnow()
    )
    db.add(job)
    db.commit()

    try:
        job.status = "running"
        job.progress = 20.0
        db.commit()
        n = embed_failure_labels(db, payload.benchmark_slug, payload.run_ids, payload.embedding_model)
        job.status = "completed"
        job.progress = 100.0
        job.result = {"embedded_count": n}
        job.finished_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Embedding generation failed: {e}")

    return {"data": {"job_id": job_id, "embedded_count": n}, "error": None}

class ReclusterFailureModesRequest(BaseModel):
    benchmark_slug: str
    run_ids: list[str] | None = None
    embedding_model: str | None = None
    min_cluster_size: int = 3
    is_preview: bool = False

@router.post("/recluster-failure-modes", status_code=202)
def create_recluster_failure_modes_job(payload: ReclusterFailureModesRequest, db: Session = Depends(get_db)):
    job_id = str(uuid.uuid4())
    job = Job(
        id=job_id,
        type="recluster_failure_modes",
        status="pending",
        progress=0.0,
        payload=payload.dict(),
        created_at=datetime.utcnow()
    )
    db.add(job)
    db.commit()

    try:
        job.status = "running"
        job.progress = 20.0
        db.commit()
        res = cluster_failure_modes(
            db=db,
            benchmark_slug=payload.benchmark_slug,
            run_ids=payload.run_ids,
            embedding_model=payload.embedding_model,
            min_cluster_size=payload.min_cluster_size,
            is_preview=payload.is_preview
        )
        job.status = "completed"
        job.progress = 100.0
        job.result = {
            "cluster_run_id": job_id,
            "timestamp": datetime.utcnow().isoformat(),
            "parameters": {
                "benchmark_slug": payload.benchmark_slug,
                "run_ids": payload.run_ids,
                "embedding_model": payload.embedding_model,
                "min_cluster_size": payload.min_cluster_size
            },
            **res
        }
        job.finished_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Clustering failed: {e}")

    return {"data": {"job_id": job_id, "result": job.result}, "error": None}

class ClusterRequest(BaseModel):
    run_ids: list[str] | None = None
    run_id: str | None = None

@router.post("/cluster")
def create_cluster_job(payload: ClusterRequest, db: Session = Depends(get_db)):
    # Legacy wrapper mapping to recluster_failure_modes or running run_cluster_job
    job_id = str(uuid.uuid4())
    job = Job(
        id=job_id,
        type="cluster",
        status="pending",
        progress=0.0,
        payload=payload.dict(),
        created_at=datetime.utcnow()
    )
    db.add(job)
    db.commit()

    try:
        job.status = "running"
        job.progress = 10.0
        db.commit()
        run_cluster_job(job_id, payload.dict())
        db.refresh(job)
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Clustering failed: {e}")

    return {"data": {"job_id": job_id, "result": job.result}, "error": None}

@router.get("/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Return formatted job dictionary for response structure compatibility
    return {
        "data": {
            "id": job.id,
            "type": job.type,
            "status": job.status,
            "progress": job.progress,
            "payload": job.payload,
            "result": job.result,
            "error": job.error,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None
        },
        "error": None
    }
