import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.deps import get_db
from app.domain.models import (
    Run, FailureMode, EvalSuite, EvalRun, Experiment, ExperimentVariant
)

router = APIRouter(prefix="/experiments", tags=["experiments"])

# ------------------------------------------------------------------ #
#  Schemas                                                           #
# ------------------------------------------------------------------ #

class TargetSpec(BaseModel):
    type: str  # failure_mode|eval_suite
    id: str
    desired_delta: float

class GuardSuiteSpec(BaseModel):
    eval_suite_id: str
    max_allowed_drop: float

class RegressionPolicy(BaseModel):
    guard_suites: List[GuardSuiteSpec]
    global_min_success_rate: float

class CreateExperimentRequest(BaseModel):
    benchmark_slug: str
    name: str
    description: str
    base_harness_version_id: str
    target_description: str
    targets: List[TargetSpec]
    regression_policy: RegressionPolicy

class CreateVariantRequest(BaseModel):
    variant_label: str
    harness_version_id: str

class LinkEvalRunRequest(BaseModel):
    eval_run_id: str

# ------------------------------------------------------------------ #
#  Helper Functions                                                  #
# ------------------------------------------------------------------ #

def get_eval_pass_rate(db: Session, suite_id: str, harness_version_id: str, variant_id: Optional[str] = None) -> float:
    query = db.query(EvalRun).filter(
        EvalRun.eval_suite_id == suite_id,
        EvalRun.status == "completed",
        EvalRun.harness_version_id == harness_version_id
    )
    if variant_id:
        query = query.filter(EvalRun.experiment_variant_id == variant_id)
    else:
        query = query.filter(EvalRun.experiment_variant_id == None)
        
    run = query.order_by(EvalRun.created_at.desc()).first()
    if run and run.metrics:
        return float(run.metrics.get("pass_rate", 0.0))
    return 0.0

def resolve_target_suite(db: Session, target_type: str, target_id: str) -> Optional[EvalSuite]:
    if target_type == "eval_suite":
        return db.query(EvalSuite).filter(EvalSuite.id == target_id).first()
    elif target_type == "failure_mode":
        suites = db.query(EvalSuite).filter(EvalSuite.source_type == "failure_mode").all()
        for s in suites:
            meta = s.source_metadata or {}
            if meta.get("failure_mode_id") == target_id:
                return s
    return None

# ------------------------------------------------------------------ #
#  Endpoints                                                         #
# ------------------------------------------------------------------ #

@router.post("")
def create_experiment(
    payload: CreateExperimentRequest,
    db: Session = Depends(get_db)
):
    from app.domain.models import _resolve_harness_version_id

    # Resolve harness version slug/name to integer ID
    hv_id = _resolve_harness_version_id(payload.base_harness_version_id)

    # Map pydantic types to dict
    targets_dict = [t.dict() for t in payload.targets]
    policy_dict = payload.regression_policy.dict()

    experiment = Experiment(
        benchmark_slug=payload.benchmark_slug,
        name=payload.name,
        description=payload.description,
        base_harness_version_id=hv_id,
        target_description=payload.target_description,
        targets=targets_dict,
        regression_policy=policy_dict,
        created_at=datetime.utcnow()
    )
    db.add(experiment)
    db.commit()
    db.refresh(experiment)

    return {"data": {"experiment_id": experiment.id}, "error": None}


@router.get("")
def list_experiments(
    benchmark_slug: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(Experiment).order_by(Experiment.created_at.desc())
    if benchmark_slug:
        query = query.filter(Experiment.benchmark_slug == benchmark_slug)
    
    return {"data": query.all(), "error": None}


@router.get("/{id}")
def get_experiment_details(id: str, db: Session = Depends(get_db)):
    exp = db.query(Experiment).filter(Experiment.id == id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return {"data": exp, "error": None}


@router.post("/{experiment_id}/variants")
def create_variant(
    experiment_id: str,
    payload: CreateVariantRequest,
    db: Session = Depends(get_db)
):
    from app.domain.models import _resolve_harness_version_id

    try:
        exp_id = int(experiment_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid experiment ID format")

    exp = db.query(Experiment).filter(Experiment.id == exp_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")

    hv_id = _resolve_harness_version_id(payload.harness_version_id)

    variant = ExperimentVariant(
        experiment_id=exp_id,
        variant_label=payload.variant_label,
        harness_version_id=hv_id,
        status="pending",
        summary_metrics=None,
        created_at=datetime.utcnow()
    )
    db.add(variant)
    db.commit()
    db.refresh(variant)

    return {"data": {"experiment_variant_id": variant.id}, "error": None}


@router.get("/{experiment_id}/variants")
def list_variants(
    experiment_id: str,
    db: Session = Depends(get_db)
):
    exp = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")

    variants = (
        db.query(ExperimentVariant)
        .filter(ExperimentVariant.experiment_id == experiment_id)
        .order_by(ExperimentVariant.created_at.desc())
        .all()
    )
    return {"data": variants, "error": None}


@router.post("/{experiment_id}/variants/{variant_id}/link-eval-run")
def link_eval_run(
    experiment_id: str,
    variant_id: str,
    payload: LinkEvalRunRequest,
    db: Session = Depends(get_db)
):
    variant = db.query(ExperimentVariant).filter(
        ExperimentVariant.id == variant_id,
        ExperimentVariant.experiment_id == experiment_id
    ).first()
    if not variant:
        raise HTTPException(status_code=404, detail="Experiment variant not found")

    eval_run = db.query(EvalRun).filter(EvalRun.id == payload.eval_run_id).first()
    if not eval_run:
        raise HTTPException(status_code=404, detail="Eval run not found")

    eval_run.experiment_variant_id = variant_id
    db.commit()

    return {"data": {"success": True}, "error": None}


@router.post("/{experiment_id}/variants/{variant_id}/compute-promotion")
def compute_promotion(
    experiment_id: str,
    variant_id: str,
    db: Session = Depends(get_db)
):
    experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")

    variant = db.query(ExperimentVariant).filter(
        ExperimentVariant.id == variant_id,
        ExperimentVariant.experiment_id == experiment_id
    ).first()
    if not variant:
        raise HTTPException(status_code=404, detail="Experiment variant not found")

    # Load targets and policy
    targets = experiment.targets or []
    policy = experiment.regression_policy or {}
    guard_suites = policy.get("guard_suites", [])
    global_min_success_rate = float(policy.get("global_min_success_rate", 0.0))

    rejection_reasons = []
    decision = "promoted"

    # 1. Evaluate Targets
    target_scorecards = []
    for t in targets:
        desired_delta = float(t.get("desired_delta", 0.03))
        suite = resolve_target_suite(db, t.get("type"), t.get("id"))
        
        suite_id = suite.id if suite else "unknown"
        pass_base = 0.0
        pass_var = 0.0
        
        if suite:
            pass_base = get_eval_pass_rate(db, suite.id, experiment.base_harness_version_id)
            pass_var = get_eval_pass_rate(db, suite.id, variant.harness_version_id, variant.id)
            
        delta = round(pass_var - pass_base, 4)
        target_scorecards.append({
            "id": t.get("id"),
            "type": t.get("type"),
            "suite_id": suite_id,
            "pass_rate_base": pass_base,
            "pass_rate_variant": pass_var,
            "desired_delta": desired_delta,
            "delta": delta
        })

        if delta < desired_delta:
            rejection_reasons.append(
                f"Target {t.get('id')} ({t.get('type')}) improved by {delta:+.2%}, failing to meet target delta of {desired_delta:+.2%}."
            )
            decision = "rejected"

    # 2. Evaluate Guard Suites
    guard_scorecards = []
    for g in guard_suites:
        g_suite_id = g.get("eval_suite_id")
        max_allowed_drop = float(g.get("max_allowed_drop", 0.0))
        
        pass_base = get_eval_pass_rate(db, g_suite_id, experiment.base_harness_version_id)
        pass_var = get_eval_pass_rate(db, g_suite_id, variant.harness_version_id, variant.id)
        delta = round(pass_var - pass_base, 4)
        
        guard_scorecards.append({
            "suite_id": g_suite_id,
            "pass_rate_base": pass_base,
            "pass_rate_variant": pass_var,
            "max_allowed_drop": max_allowed_drop,
            "delta": delta
        })

        # Drop is representable as negative delta, so delta must be >= -max_allowed_drop
        if delta < -max_allowed_drop:
            rejection_reasons.append(
                f"Guard suite {g_suite_id} regressed by {delta:+.2%} (max allowed drop: {max_allowed_drop:.2%})."
            )
            decision = "rejected"

    # 3. Evaluate Global success rate
    overall_success_rate_base = 0.0
    overall_success_rate_variant = 0.0

    run_base = db.query(Run).filter(Run.harness_version_id == experiment.base_harness_version_id).order_by(Run.created_at.desc()).first()
    if run_base:
        overall_success_rate_base = float(run_base.global_score or 0.0)
    else:
        base_runs = db.query(EvalRun).filter(
            EvalRun.harness_version_id == experiment.base_harness_version_id,
            EvalRun.experiment_variant_id == None,
            EvalRun.status == "completed"
        ).all()
        if base_runs:
            overall_success_rate_base = sum(float(r.metrics.get("pass_rate", 0.0)) for r in base_runs) / len(base_runs)

    run_var = db.query(Run).filter(Run.harness_version_id == variant.harness_version_id).order_by(Run.created_at.desc()).first()
    if run_var:
        overall_success_rate_variant = float(run_var.global_score or 0.0)
    else:
        var_runs = db.query(EvalRun).filter(
            EvalRun.experiment_variant_id == variant.id,
            EvalRun.status == "completed"
        ).all()
        if var_runs:
            overall_success_rate_variant = sum(float(r.metrics.get("pass_rate", 0.0)) for r in var_runs) / len(var_runs)

    if overall_success_rate_variant < global_min_success_rate:
        rejection_reasons.append(
            f"Global success rate {overall_success_rate_variant:.2%} fell below the required floor of {global_min_success_rate:.2%}."
        )
        decision = "rejected"

    # 4. Find Backbone Suite (for general capabilities check)
    backbone_suite = None
    all_suites = db.query(EvalSuite).filter(EvalSuite.benchmark_slug == experiment.benchmark_slug).all()
    for s in all_suites:
        if "backbone" in s.id.lower() or "backbone" in s.name.lower():
            backbone_suite = s
            break
    if not backbone_suite and all_suites:
        target_ids = {t.get("id") for t in targets}
        guard_ids = {g.get("eval_suite_id") for g in guard_suites}
        for s in all_suites:
            meta = s.source_metadata or {}
            fm_id = meta.get("failure_mode_id")
            if s.id not in guard_ids and s.id not in target_ids and fm_id not in target_ids:
                backbone_suite = s
                break
        if not backbone_suite:
            backbone_suite = all_suites[0]

    pass_rate_base_bb = 0.0
    pass_rate_variant_bb = 0.0
    if backbone_suite:
        pass_rate_base_bb = get_eval_pass_rate(db, backbone_suite.id, experiment.base_harness_version_id)
        pass_rate_variant_bb = get_eval_pass_rate(db, backbone_suite.id, variant.harness_version_id, variant.id)

    # Denormalized Scorecard
    scorecard = {
        "backbone": {
            "pass_rate_base": pass_rate_base_bb,
            "pass_rate_variant": pass_rate_variant_bb,
            "delta": round(pass_rate_variant_bb - pass_rate_base_bb, 4)
        },
        "targets": target_scorecards,
        "guards": guard_scorecards,
        "global": {
            "overall_success_rate_base": overall_success_rate_base,
            "overall_success_rate_variant": overall_success_rate_variant
        },
        "efficiency": {
            "cost_base": 1.0,
            "cost_variant": 1.0
        },
        "decision": decision,
        "decision_reason": "; ".join(rejection_reasons) if rejection_reasons else "Variant promoted: all targets met, guard suites satisfied, global success floor cleared."
    }

    # Persist back to DB
    variant.status = decision
    variant.summary_metrics = scorecard
    if decision == "promoted":
        variant.promoted_at = datetime.utcnow()
    else:
        variant.promoted_at = None

    db.commit()

    return {
        "data": {
            "decision": decision,
            "summary_metrics": scorecard
        },
        "error": None
    }
