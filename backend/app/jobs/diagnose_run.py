import json
import re
import uuid
from datetime import datetime
from sqlalchemy.orm import Session
from app.core.logging import get_logger
from app.domain.models import Run, RunTask, TraceStep, FailureLabel
from app.core.llm_client import llm_client
from app.api.schemas.failure_label import FailureLabelLLM

log = get_logger(__name__)

SYSTEM_PROMPT = """You are a failure analysis system for AI agents.

You must respond in JSON only.

Given a failed benchmark task and its execution trace, identify:
- diagnosis_text: 1-3 concise sentences explaining the primary reason for failure
- taxonomy_primary: one of [gap, ambiguity, tool_misuse, code_bug, upstream, safety, other]
- severity: one of [low, medium, high, critical]
- confidence: one of [low, medium, high]

Rules:
- Focus on the main cause of failure, not a full play-by-play.
- Prefer concrete operational causes (wrong command, bad cwd, missing dependency).
- Do not output anything other than JSON."""

def build_failure_prompt(task: RunTask, trace_steps: list[TraceStep]) -> str:
    # keep only the most useful parts
    # - task metadata
    # - status + score
    # - last N informative steps (commands + logs + errors)
    last_steps = sorted(trace_steps, key=lambda s: s.step_index)[-20:]
    steps_text = "\n".join(
        f"[{s.step_type}] {s.content}" for s in last_steps
    )

    task_metadata = task.raw_task.get("task_metadata", {}) if task.raw_task else {}

    return f"""Analyze this failed agent run and return JSON.

Task metadata:
{json.dumps(task_metadata, ensure_ascii=False)}

Status:
status={task.status}, score={task.score}

Recent trace:
{steps_text}

Return only JSON with:
{{
  "diagnosis_text": "...",
  "taxonomy_primary": "...",
  "severity": "...",
  "confidence": "..."
}}
"""

def generate_heuristic_diagnosis(task: RunTask, trace_steps: list[TraceStep]) -> dict:
    # Sort steps by step_index
    sorted_steps = sorted(trace_steps, key=lambda s: s.step_index or 0)
    
    # We want last 5 steps content for the search
    last_steps = sorted_steps[-5:]
    last_steps_text = " ".join(s.content or "" for s in last_steps).lower()
    
    # Extract task description from task.raw_task
    task_desc = ""
    if task.raw_task:
        meta = task.raw_task.get("task_metadata", {})
        if isinstance(meta, dict):
            task_desc = meta.get("instruction") or meta.get("description") or meta.get("goal") or ""
        if not task_desc:
            task_desc = task.raw_task.get("description") or ""
            
    slug = task.task_slug or ""
    
    full_text = f"{task_desc} {slug} {last_steps_text}".lower()
    
    diagnosis_text = "Agent failed to complete the task successfully. "
    taxonomy_primary = "tool_misuse"
    severity = "medium"
    confidence = "low"
    
    # Heuristic rule 1: Python/Syntax/Code Bugs
    if any(x in full_text for x in ['syntaxerror', 'traceback', 'typeerror', 'nullpointer', 'referenceerror', 'undefined', 'import error', 'module not found']):
        taxonomy_primary = "code_bug"
        # Match error patterns in last_steps_text
        match = re.search(r"(?:error|exception|traceback):?\s*([^\n]+)", last_steps_text, re.IGNORECASE)
        if match:
            diagnosis_text = f"Code execution failed due to a runtime bug: {match.group(1).strip()}"
        else:
            diagnosis_text = "Agent encountered a programming exception or traceback in its execution script."
            
    # Heuristic rule 2: Safety & Policy
    elif any(x in full_text for x in ['safety', 'policy', 'forbidden', 'unauthorized', 'block', 'abuse']):
        taxonomy_primary = "safety"
        diagnosis_text = "The agent trajectory triggered a security filter, permission restriction, or content safety policy."
        
    # Heuristic rule 3: Ambiguity
    elif any(x in full_text for x in ['ambiguous', 'unclear', 'specify', 'choose between', 'conflicting']):
        taxonomy_primary = "ambiguity"
        diagnosis_text = "Task instructions are underspecified or conflicting, making it impossible to determine the correct target state."
        
    # Heuristic rule 4: Environment/Network/Upstream
    elif any(x in full_text for x in ['connection timed out', '502 bad gateway', '500 internal server', 'could not resolve host', 'network is unreachable', 'connection refused']):
        taxonomy_primary = "upstream"
        diagnosis_text = "Execution failed due to external system dependencies, host resolution issues, or network unavailability."
        
    # Heuristic rule 5: Capabilities/Tools Gap
    elif any(x in full_text for x in ['command not found', 'permission denied', 'not permitted', 'tool not available', 'missing package', 'apt-get install']):
        taxonomy_primary = "gap"
        diagnosis_text = "Agent was missing required OS utilities, packages, permissions, or specialized tools to run the requested commands."
        
    # Heuristic rule 6: Tool Misuse / standard failures
    else:
        taxonomy_primary = "tool_misuse"
        # Find some text describing the command failure
        tool_call = next((s for s in sorted_steps if s.step_type in ('tool_call', 'command')), None)
        if tool_call and tool_call.content:
            short_content = tool_call.content[:60]
            diagnosis_text = f"Agent attempted to call tools but misused parameters or provided invalid arguments: \"{short_content}\"."
        else:
            diagnosis_text = "Agent exited or stalled without completing key requirements, likely due to incorrect logic loop parameters."
            
    return {
        "diagnosis_text": diagnosis_text,
        "taxonomy_primary": taxonomy_primary,
        "severity": severity,
        "confidence": confidence
    }

def diagnose_run(db: Session, run_id: str, prompt_version: str = "diag_v1", model_version: str | None = None) -> int:
    run = db.query(Run).filter(Run.id == run_id).first()
    if not run:
        raise ValueError("run not found")

    # Status check is case-insensitive (e.g. check for not 'pass'/'PASS')
    failed_tasks = (
        db.query(RunTask)
        .filter(RunTask.run_id == run_id, RunTask.status != "pass", RunTask.status != "PASS")
        .all()
    )
    if not failed_tasks:
        return 0

    count = 0
    for t in failed_tasks:
        trace_steps = (
            db.query(TraceStep)
            .filter(TraceStep.run_task_id == t.id)
            .order_by(TraceStep.step_index)
            .all()
        )
        user_prompt = build_failure_prompt(t, trace_steps)

        # first attempt
        try:
            parsed, latency_ms = llm_client.chat_json(SYSTEM_PROMPT, user_prompt)
            validated = FailureLabelLLM(**parsed)
        except Exception as e:
            log.warning(f"First diagnosis attempt failed for task {t.id}: {e}. Retrying...")
            # one retry with stricter instructions
            retry_prompt = user_prompt + "\n\nREMINDER: You must output valid JSON matching the schema exactly."
            try:
                parsed, latency_ms = llm_client.chat_json(SYSTEM_PROMPT, retry_prompt)
                validated = FailureLabelLLM(**parsed)
            except Exception as retry_err:
                log.warning(f"Retry diagnosis attempt failed for task {t.id}: {retry_err}. Falling back...")
                # fall back to heuristics
                parsed = generate_heuristic_diagnosis(t, trace_steps)
                latency_ms = 0.0
                validated = FailureLabelLLM(**parsed)

        # Clear existing failure label for the task to avoid unique constraint violations
        db.query(FailureLabel).filter(FailureLabel.run_task_id == t.id).delete()

        # Map incoming tag
        mapped_taxonomy = "OTHER"
        clean_taxonomy = (validated.taxonomy_primary or "").upper()
        valid_taxonomies = {'GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER'}
        if clean_taxonomy in valid_taxonomies:
            mapped_taxonomy = clean_taxonomy
        elif clean_taxonomy == 'SAFETY_VIOLATION':
            mapped_taxonomy = 'SAFETY'

        fl = FailureLabel(
            run_task_id=t.id,
            diagnosis_text=validated.diagnosis_text,
            taxonomy_primary=mapped_taxonomy,
            source="LLM_JUDGE",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(fl)
        count += 1

    db.commit()
    return count
