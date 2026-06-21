import uuid
from datetime import datetime
from typing import Optional, List, Union
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.deps import get_db
from app.domain.models import (
    Run, RunTask, FailureLabel, FailureMode, FailureModeMember,
    EvalSuite, EvalCase, EvalRun, EvalRunResult, eval_suite_members
)
from app.core.settings import get_settings
from app.jobs.evals_runner import execute_eval_run

settings = get_settings()

router_suites = APIRouter(prefix="/eval-suites", tags=["eval-suites"])
router_runs = APIRouter(prefix="/eval-runs", tags=["eval-runs"])

# ------------------------------------------------------------------ #
#  Schemas                                                           #
# ------------------------------------------------------------------ #

class CreateSuiteFromFailureModeRequest(BaseModel):
    failure_mode_id: Union[int, str]
    name: str
    description: str
    max_cases: int = 20
    scoring_strategy: str = "benchmark_native"

class EvalRunRequest(BaseModel):
    eval_suite_id: str
    harness_version_id: str
    mode: str  # offline_replay|online_rerun

class CreateManualSuiteRequest(BaseModel):
    name: str
    description: str
    benchmark_slug: str = "terminal-bench@2.0"
    source_type: str = "manual"
    scoring_strategy: str = "benchmark_native"
    case_count: int = 0

class CreateEvalCaseRequest(BaseModel):
    eval_suite_id: str
    failure_label_id: Optional[Union[int, str]] = None
    run_task_id: Optional[Union[int, str]] = None
    run_id: Optional[Union[int, str]] = None
    benchmark_task_id: Union[int, str]
    input_spec: dict
    expected_spec: Optional[dict] = None
    scoring_strategy: str = "benchmark_native"
    weight: float = 1.0

# ------------------------------------------------------------------ #
#  Eval Suites Endpoints                                             #
# ------------------------------------------------------------------ #

@router_suites.post("/from-failure-mode")
def create_suite_from_failure_mode(
    payload: CreateSuiteFromFailureModeRequest,
    db: Session = Depends(get_db)
):
    # Fetch failure mode
    fm_id = payload.failure_mode_id
    if isinstance(fm_id, str) and fm_id.isdigit():
        fm_id = int(fm_id)
    fm = db.query(FailureMode).filter(FailureMode.id == fm_id).first()
    if not fm:
        raise HTTPException(status_code=404, detail="Failure mode not found")

    # Fetch failure mode members
    members = db.query(FailureModeMember).filter(FailureModeMember.failure_mode_id == fm.id).all()
    if not members:
        raise HTTPException(status_code=400, detail="Failure mode has no associated members")

    # Map members to failure labels
    labels_with_members = []
    for m in members:
        fl = db.query(FailureLabel).filter(FailureLabel.id == m.failure_label_id).first()
        if fl:
            labels_with_members.append((fl, m))

    # Sort: severity descending, then distance ascending, then recency descending
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    def sort_key(item):
        fl, m = item
        sev = severity_order.get(str(fl.severity).lower(), 4)
        dist = float(m.distance) if m.distance is not None else 999.0
        recency = fl.created_at.timestamp() if fl.created_at else 0.0
        return (sev, dist, -recency)

    labels_with_members.sort(key=sort_key)
    selected = labels_with_members[:payload.max_cases]

    # Create EvalSuite
    suite_id = str(uuid.uuid4())
    suite = EvalSuite(
        id=suite_id,
        benchmark_slug=fm.benchmark_slug or "unknown",
        name=payload.name,
        description=payload.description,
        source_type="failure_mode",
        source_metadata={"failure_mode_id": fm.id},
        case_count=len(selected),
        scoring_strategy=payload.scoring_strategy,
        created_at=datetime.utcnow()
    )
    db.add(suite)

    # Create EvalCases
    for fl, m in selected:
        rt = db.query(RunTask).filter(RunTask.id == fl.run_task_id).first()
        r = db.query(Run).filter(Run.id == fl.run_id).first()

        case = EvalCase(
            id=str(uuid.uuid4()),
            eval_suite_id=suite_id,
            failure_label_id=fl.id,
            run_id=fl.run_id,
            run_task_id=fl.run_task_id,
            benchmark_task_id=rt.benchmark_task_id if rt else "unknown",
            input_spec={
                "benchmark_slug": r.benchmark_slug if r else "unknown",
                "dataset": settings.tb_dataset,
                "benchmark_task_id": rt.benchmark_task_id if rt else "unknown",
                "run_seed": r.raw_artifact_uri or r.id if r else None,
            },
            expected_spec={},
            scoring_strategy=payload.scoring_strategy,
            weight=1.0,
            created_at=datetime.utcnow()
        )
        db.add(case)

    db.commit()
    db.refresh(suite)
    return {"data": serialize_suite(suite), "error": None}


@router_suites.post("")
def create_manual_suite(
    payload: CreateManualSuiteRequest,
    db: Session = Depends(get_db)
):
    suite_id = str(uuid.uuid4())
    suite = EvalSuite(
        id=suite_id,
        benchmark_slug=payload.benchmark_slug,
        name=payload.name,
        description=payload.description,
        source_type=payload.source_type,
        source_metadata={},
        case_count=payload.case_count,
        scoring_strategy=payload.scoring_strategy,
        created_at=datetime.utcnow()
    )
    db.add(suite)
    db.commit()
    db.refresh(suite)
    return {"data": serialize_suite(suite), "error": None}


def serialize_suite(suite: EvalSuite):
    return {
        "id": suite.id,
        "name": suite.name,
        "benchmark_slug": suite.benchmark_slug,
        "description": suite.description,
        "source_type": suite.source_type,
        "source_metadata": suite.source_metadata,
        "case_count": suite.case_count,
        "scoring_strategy": suite.scoring_strategy,
        "created_at": suite.created_at,
    }


def serialize_case(case: EvalCase):
    return {
        "id": case.id,
        "eval_suite_id": case.eval_suite_id,
        "benchmark_task_id": case.benchmark_task_id,
        "failure_label_id": case.failure_label_id,
        "input_spec": case.input_spec,
        "expected_spec": case.expected_spec,
        "scoring_strategy": case.scoring_strategy,
        "weight": case.weight,
        "created_by": case.created_by,
        "created_at": case.created_at,
    }


@router_suites.post("/{id}/cases")
def create_eval_case(
    id: str,
    payload: CreateEvalCaseRequest,
    db: Session = Depends(get_db)
):
    suite = db.query(EvalSuite).filter(EvalSuite.id == id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Eval suite not found")

    case_id = str(uuid.uuid4())
    case = EvalCase(
        id=case_id,
        eval_suite_id=id,
        failure_label_id=payload.failure_label_id,
        run_id=payload.run_id,
        run_task_id=payload.run_task_id,
        benchmark_task_id=payload.benchmark_task_id,
        input_spec=payload.input_spec,
        expected_spec=payload.expected_spec or {},
        scoring_strategy=payload.scoring_strategy,
        weight=payload.weight,
        created_at=datetime.utcnow()
    )
    db.add(case)
    
    # Increment suite case count
    suite.case_count += 1
    db.commit()
    db.refresh(case)
    return {"data": serialize_case(case), "error": None}


@router_suites.get("")
def list_suites(
    benchmark_slug: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(EvalSuite)
    if benchmark_slug:
        query = query.filter(EvalSuite.benchmark_slug == benchmark_slug)
    if source_type:
        query = query.filter(EvalSuite.source_type == source_type)
    
    suites = query.all()
    
    # Group by name to deduplicate
    grouped = {}
    for s in suites:
        name = s.name.strip()
        if name not in grouped:
            grouped[name] = []
        grouped[name].append(s)
        
    sorted_names = sorted(grouped.keys())
    
    res = []
    for name in sorted_names:
        suite_list = grouped[name]
        suite_list.sort(key=lambda s: s.created_at or datetime.min, reverse=True)
        primary = suite_list[0]
        
        # Calculate combined case count uniquely by benchmark_task_id
        # to avoid duplicating cases across duplicate suites!
        suite_ids = [s.id for s in suite_list]
        unique_case_count = (
            db.query(func.count(func.distinct(EvalCase.benchmark_task_id_int)))
            .join(eval_suite_members, eval_suite_members.c.eval_case_id == EvalCase.id)
            .filter(eval_suite_members.c.eval_suite_id.in_(suite_ids))
            .scalar()
        ) or 0
        
        res.append({
            "id": primary.id,
            "name": name,
            "description": primary.description,
            "benchmark_slug": primary.benchmark_slug,
            "case_count": unique_case_count,
            "source_type": primary.source_type,
            "scoring_strategy": primary.scoring_strategy,
            "created_at": primary.created_at
        })
        
    return {"data": res, "error": None}


@router_suites.get("/{id}")
def get_suite_details(id: str, db: Session = Depends(get_db)):
    suite = db.query(EvalSuite).filter(EvalSuite.id == id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Eval suite not found")
        
    # Find all duplicate suites with the same name
    duplicates = db.query(EvalSuite).filter(EvalSuite.name == suite.name).all()
    suite_ids = [s.id for s in duplicates]
    
    # Combined case count
    unique_case_count = (
        db.query(func.count(func.distinct(EvalCase.benchmark_task_id_int)))
        .join(eval_suite_members, eval_suite_members.c.eval_case_id == EvalCase.id)
        .filter(eval_suite_members.c.eval_suite_id.in_(suite_ids))
        .scalar()
    ) or 0
    
    suite.case_count = unique_case_count
    return {"data": serialize_suite(suite), "error": None}


@router_suites.get("/{id}/cases")
def get_suite_cases(
    id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    suite = db.query(EvalSuite).filter(EvalSuite.id == id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Eval suite not found")

    duplicates = db.query(EvalSuite).filter(EvalSuite.name == suite.name).all()
    suite_ids = [s.id for s in duplicates]

    offset = (page - 1) * page_size
    
    # Count distinct benchmark tasks across all suite IDs
    total = (
        db.query(func.count(func.distinct(EvalCase.benchmark_task_id_int)))
        .join(eval_suite_members, eval_suite_members.c.eval_case_id == EvalCase.id)
        .filter(eval_suite_members.c.eval_suite_id.in_(suite_ids))
        .scalar()
    ) or 0

    # Get one representative case per benchmark_task_id_int via min(id) subquery
    case_ids_subq = (
        db.query(func.min(EvalCase.id).label('case_id'))
        .join(eval_suite_members, eval_suite_members.c.eval_case_id == EvalCase.id)
        .filter(eval_suite_members.c.eval_suite_id.in_(suite_ids))
        .group_by(EvalCase.benchmark_task_id_int)
        .subquery()
    )
    cases = (
        db.query(EvalCase)
        .filter(EvalCase.id.in_(db.query(case_ids_subq.c.case_id)))
        .order_by(EvalCase.created_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    return {
        "data": [serialize_case(c) for c in cases],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "pages": (total + page_size - 1) // page_size if total > 0 else 0
        },
        "error": None
    }


# ------------------------------------------------------------------ #
#  Eval Runs Endpoints                                              #
# ------------------------------------------------------------------ #

def execute_eval_run_wrapper(eval_run_id: str):
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        execute_eval_run(db, eval_run_id)
    except Exception as e:
        # Captured in job log, wrapper doesn't need to propagate
        pass
    finally:
        db.close()


@router_runs.post("", status_code=202)
def create_eval_run(
    payload: EvalRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    suite = db.query(EvalSuite).filter(EvalSuite.id == payload.eval_suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Eval suite not found")

    run_id = str(uuid.uuid4())
    # Resolve harness version name to integer FK
    from app.domain.models import _resolve_harness_version_id
    hv_id = payload.harness_version_id
    if isinstance(hv_id, str) and not hv_id.isdigit():
        hv_id = _resolve_harness_version_id(hv_id)
    else:
        hv_id = int(hv_id)
    eval_run = EvalRun(
        id=run_id,
        eval_suite_id=payload.eval_suite_id,
        harness_version_id=hv_id,
        run_mode=payload.mode,
        status="pending",
        metrics={},
        created_at=datetime.utcnow()
    )
    db.add(eval_run)
    db.commit()
    db.refresh(eval_run)

    # Enqueue execution in background thread
    background_tasks.add_task(execute_eval_run_wrapper, run_id)

    return {"data": eval_run, "error": None}


@router_runs.get("")
def list_eval_runs(
    eval_suite_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(EvalRun).order_by(EvalRun.created_at.desc())
    if eval_suite_id:
        suite = db.query(EvalSuite).filter(EvalSuite.id == eval_suite_id).first()
        if suite:
            duplicates = db.query(EvalSuite).filter(EvalSuite.name == suite.name).all()
            suite_ids = [s.id for s in duplicates]
            query = query.filter(EvalRun.eval_suite_id.in_(suite_ids))
        else:
            query = query.filter(EvalRun.eval_suite_id == eval_suite_id)
    return {"data": query.all(), "error": None}


@router_runs.get("/{id}")
def get_eval_run_details(id: str, db: Session = Depends(get_db)):
    eval_run = db.query(EvalRun).filter(EvalRun.id == id).first()
    if not eval_run:
        raise HTTPException(status_code=404, detail="Eval run not found")
    return {"data": eval_run, "error": None}


@router_runs.get("/{id}/results")
def get_eval_run_results(
    id: str,
    db: Session = Depends(get_db)
):
    eval_run = db.query(EvalRun).filter(EvalRun.id == id).first()
    if not eval_run:
        raise HTTPException(status_code=404, detail="Eval run not found")

    results = (
        db.query(EvalRunResult)
        .filter(EvalRunResult.eval_run_id == id)
        .all()
    )

    serialized = []
    for r in results:
        case = db.query(EvalCase).filter(EvalCase.id == r.eval_case_id).first()
        serialized.append({
            "eval_run_id": r.eval_run_id,
            "eval_case_id": r.eval_case_id,
            "benchmark_task_id": case.benchmark_task_id if case else "unknown",
            "status": r.status,
            "score": r.score,
            "raw_output": r.raw_output,
            "judge_metadata": r.judge_metadata
        })

    return {"data": serialized, "error": None}
