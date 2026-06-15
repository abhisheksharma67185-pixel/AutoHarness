from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.api.v1.deps import get_db
from app.domain.models import Run, RunTask, TraceStep, FailureLabel, FailureMode, FailureModeMember

router = APIRouter(prefix="/runs", tags=["runs"])

@router.get("/")
def list_runs(
    benchmark_slug: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(Run).order_by(Run.created_at.desc())
    if benchmark_slug:
        query = query.filter(Run.benchmark_slug == benchmark_slug)
    if status:
        query = query.filter(Run.status == status)
    runs = query.all()
    return {"data": runs, "error": None}

failure_modes_router = APIRouter(prefix="/failure-modes", tags=["failure-modes"])

def get_failure_modes_helper(benchmark_slug: Optional[str], run_id: Optional[str], db: Session):
    query = db.query(FailureMode)

    if benchmark_slug:
        query = query.filter(FailureMode.benchmark_slug == benchmark_slug)

    if run_id:
        query = (
            query.join(FailureModeMember, FailureMode.id == FailureModeMember.failure_mode_id)
            .join(FailureLabel, FailureModeMember.failure_label_id == FailureLabel.id)
            .filter(FailureLabel.run_id == run_id)
        )

    modes = query.distinct().all()

    enriched_modes = []

    # Check trend based on previous runs
    previous_runs = []
    if run_id:
        current_run = db.query(Run).filter(Run.id == run_id).first()
        if current_run:
            previous_runs = (
                db.query(Run)
                .filter(
                    Run.agent_name == current_run.agent_name,
                    Run.benchmark_slug == current_run.benchmark_slug,
                    Run.created_at < current_run.created_at,
                    Run.id != run_id
                )
                .order_by(Run.created_at.desc())
                .limit(3)
                .all()
            )

    # Group failure modes by name to deduplicate
    grouped_modes = {}
    for fm in modes:
        name = fm.name.strip()
        if name not in grouped_modes:
            grouped_modes[name] = []
        grouped_modes[name].append(fm)

    # Stable sorting by name
    sorted_names = sorted(grouped_modes.keys())

    for name in sorted_names:
        fm_list = grouped_modes[name]
        primary_fm = fm_list[0]

        # Combine all member failure labels across the modes in this group
        members_labels = []
        for fm in fm_list:
            member_labels_query = db.query(FailureLabel).join(
                FailureModeMember, FailureLabel.id == FailureModeMember.failure_label_id
            ).filter(FailureModeMember.failure_mode_id == fm.id)

            if run_id:
                member_labels_query = member_labels_query.filter(FailureLabel.run_id == run_id)

            members_labels.extend(member_labels_query.all())

        # Deduplicate failure labels by ID
        unique_labels = {}
        for fl in members_labels:
            unique_labels[fl.id] = fl
        members_labels = list(unique_labels.values())
        count = len(members_labels)

        # Pull associated tasks
        members = []
        scores = []
        for fl in members_labels:
            rt = db.query(RunTask).filter(RunTask.id == fl.run_task_id).first()
            if rt:
                desc = rt.raw_task.get("description", "") if rt.raw_task else ""
                members.append({
                    "id": rt.id,
                    "status": rt.status,
                    "score": rt.score,
                    "task_id": rt.benchmark_task_id,
                    "slug": rt.task_slug,
                    "category": rt.category,
                    "difficulty": rt.difficulty,
                    "description": desc,
                    "diagnosis_text": fl.diagnosis_text,
                    "taxonomy_label": fl.taxonomy_primary.upper()
                })
                scores.append(rt.score)

        # Stable sorting of members
        members.sort(key=lambda x: (x["task_id"], x["slug"]))
        avg_score = sum(scores) / count if count > 0 else 0.0

        # Calculate trend
        trend = "stable"
        if run_id and previous_runs:
            prev_run_id = previous_runs[0].id
            prev_count = 0
            for fm in fm_list:
                prev_count += (
                    db.query(RunTask)
                    .join(FailureLabel, RunTask.id == FailureLabel.run_task_id)
                    .join(FailureModeMember, FailureLabel.id == FailureModeMember.failure_label_id)
                    .filter(RunTask.run_id == prev_run_id, FailureModeMember.failure_mode_id == fm.id)
                    .count()
                )
            if prev_count > 0:
                if count < prev_count:
                    trend = "down"
                elif count > prev_count:
                    trend = "up"

        enriched_modes.append({
            "id": primary_fm.id,
            "benchmark_slug": primary_fm.benchmark_slug,
            "name": name,
            "title": name,
            "description": primary_fm.description,
            "taxonomy_primary": primary_fm.taxonomy_primary,
            "taxonomy_label": primary_fm.taxonomy_primary.upper(),
            "severity": primary_fm.severity,
            "failure_count": count,
            "avg_score": avg_score,
            "trend": trend,
            "members": members
        })

    return enriched_modes

@failure_modes_router.get("")
def get_failure_modes(
    benchmark_slug: Optional[str] = Query(None),
    run_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    data = get_failure_modes_helper(benchmark_slug, run_id, db)
    return {"data": data, "error": None}

@failure_modes_router.get("/{failure_mode_id}/failures")
def get_failure_mode_failures(
    failure_mode_id: str,
    db: Session = Depends(get_db)
):
    members = (
        db.query(FailureModeMember)
        .filter(FailureModeMember.failure_mode_id == failure_mode_id)
        .all()
    )

    res = []
    for m in members:
        fl = db.query(FailureLabel).filter(FailureLabel.id == m.failure_label_id).first()
        if not fl:
            continue
        rt = db.query(RunTask).filter(RunTask.id == fl.run_task_id).first()
        task_id = rt.benchmark_task_id if rt else "unknown"
        task_slug = rt.task_slug if rt else "unknown"
        res.append({
            "failure_mode_id": failure_mode_id,
            "failure_label_id": m.failure_label_id,
            "task_id": task_id,
            "task_slug": task_slug,
            "diagnosis_text": fl.diagnosis_text,
            "taxonomy_primary": fl.taxonomy_primary,
            "severity": fl.severity,
            "confidence": fl.confidence,
            "distance": m.distance
        })

    return {"data": res, "error": None}

@router.get("/failure-modes")
def get_run_failure_modes_query(run_id: str = Query(...), db: Session = Depends(get_db)):
    data = get_failure_modes_helper(None, run_id, db)
    return {"failureModes": data}

@router.get("/{run_id}/failure-modes")
def get_run_failure_modes(run_id: str, db: Session = Depends(get_db)):
    data = get_failure_modes_helper(None, run_id, db)
    return {"failureModes": data}

@router.get("/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"data": run, "error": None}

@router.get("/{run_id}/tasks")
def list_run_tasks(
    run_id: str,
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(RunTask).filter(RunTask.run_id == run_id)
    if status:
        query = query.filter(RunTask.status == status.upper())
    if category:
        query = query.filter(RunTask.category == category)
    tasks = query.order_by(RunTask.task_slug).all()
    
    serialized = []
    for t in tasks:
        desc = t.raw_task.get("description", "") if t.raw_task else ""
        serialized.append({
            "id": t.id,
            "run_id": t.run_id,
            "benchmark_task_id": t.benchmark_task_id,
            "task_slug": t.task_slug,
            "category": t.category,
            "difficulty": t.difficulty,
            "status": t.status,
            "score": t.score,
            "description": desc,
            "diagnosis_text": t.failure_label.diagnosis_text if t.failure_label else None,
            "taxonomy_label": t.failure_label.taxonomy_primary if t.failure_label else None
        })
    return {"data": serialized, "error": None}

@router.delete("/{run_id}")
def delete_run(run_id: str, db: Session = Depends(get_db)):
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    db.delete(run)
    db.commit()
    return {"success": True, "message": f"Run {run_id} successfully deleted."}

class UpdateFailureModeRequest(BaseModel):
    id: str
    title: str
    description: str
    taxonomy_label: str

@router.post("/failure-modes/update")
def update_failure_mode(payload: UpdateFailureModeRequest, db: Session = Depends(get_db)):
    valid_taxonomies = {'GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER'}
    clean_taxonomy = (payload.taxonomy_label or "").upper()
    if clean_taxonomy == 'SAFETY_VIOLATION':
        clean_taxonomy = 'SAFETY'
    if clean_taxonomy not in valid_taxonomies:
        clean_taxonomy = 'OTHER'

    # Try finding persistent FailureMode first
    fm = db.query(FailureMode).filter(FailureMode.id == payload.id).first()
    if fm:
        fm.name = payload.title
        fm.description = payload.description
        fm.taxonomy_primary = clean_taxonomy.lower()

        # Update member taxonomy_primary in failure_labels
        members = db.query(FailureModeMember).filter(FailureModeMember.failure_mode_id == fm.id).all()
        for m in members:
            fl = db.query(FailureLabel).filter(FailureLabel.id == m.failure_label_id).first()
            if fl:
                fl.taxonomy_primary = clean_taxonomy.lower()
        db.commit()
        return {"success": True, "message": "Failure mode and member taxonomies updated successfully."}

    # Fallback to dynamic grouping update (colon-separated)
    try:
        tax, sev = payload.id.split(":")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid failure mode ID format")

    labels = (
        db.query(FailureLabel)
        .filter(FailureLabel.taxonomy_primary == tax, FailureLabel.severity == sev)
        .all()
    )
    for fl in labels:
        fl.taxonomy_primary = clean_taxonomy.lower()

    db.commit()
    return {"success": True, "message": "Dynamic failure mode labels updated successfully."}
