from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/approvals", tags=["approvals"])

APPROVALS_DB: dict[str, dict[str, Any]] = {}
RUNS_DB: dict[str, dict[str, Any]] = {}


class WorkflowNode(BaseModel):
    id: str
    type: str
    data: dict[str, Any] = Field(default_factory=dict)


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: str | None = None
    targetHandle: str | None = None


class CreateApprovalRequest(BaseModel):
    run_id: str
    workflow_id: str
    node_id: str
    title: str = "Approval Required"
    description: str = "A workflow node is waiting for approval."
    fallback_action: str | None = None
    requested_by: str = "system"


class ApprovalResponse(BaseModel):
    id: str
    run_id: str
    workflow_id: str
    node_id: str
    title: str
    description: str
    fallback_action: str | None = None
    requested_by: str
    requested_at: str
    status: str
    rejection_note: str | None = None
    approved_by: str | None = None
    approved_at: str | None = None
    resumed_at: str | None = None


class ApproveAction(BaseModel):
    rejection_note: str | None = None
    approved_by: str | None = "operator"


class CreateApprovalResponse(BaseModel):
    id: str
    status: str = "pending"


class ResumeResponse(BaseModel):
    success: bool
    output: str
    logs: list[dict[str, Any]]
    status: str
    approval_id: str | None = None
    run_id: str | None = None


def create_approval(req: CreateApprovalRequest) -> dict[str, Any]:
    approval_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()
    record: dict[str, Any] = {
        "id": approval_id,
        "run_id": req.run_id,
        "workflow_id": req.workflow_id,
        "node_id": req.node_id,
        "title": req.title,
        "description": req.description,
        "fallback_action": req.fallback_action,
        "requested_by": req.requested_by,
        "requested_at": now,
        "status": "pending",
        "rejection_note": None,
        "approved_by": None,
        "approved_at": None,
        "resumed_at": None,
    }
    APPROVALS_DB[approval_id] = record
    return record


@router.post("", response_model=CreateApprovalResponse)
async def create_approval_endpoint(body: CreateApprovalRequest):
    record = create_approval(body)
    return CreateApprovalResponse(id=record["id"], status=record["status"])


@router.get("/pending", response_model=list[ApprovalResponse])
async def list_pending():
    return [
        _record_to_response(r)
        for r in APPROVALS_DB.values()
        if r["status"] == "pending"
    ]


@router.get("/run/{run_id}", response_model=list[ApprovalResponse])
async def get_approvals_by_run(run_id: str):
    return [
        _record_to_response(r)
        for r in APPROVALS_DB.values()
        if r["run_id"] == run_id
    ]


CSV_HEADERS = [
    "approval_id", "run_id", "workflow_id", "node_id", "node_title",
    "status", "requested_by", "requested_at", "approved_by", "approved_at",
    "resumed_at", "completed_at", "rejection_note", "fallback_action",
]


def _build_export_rows(run_id: str) -> list[dict[str, str]]:
    records = [r for r in APPROVALS_DB.values() if r["run_id"] == run_id]
    run = RUNS_DB.get(run_id, {})
    rows: list[dict[str, str]] = []
    for r in records:
        completed_at = run.get("completed_at", "")
        row = {
            "approval_id": r["id"],
            "run_id": r["run_id"],
            "workflow_id": r["workflow_id"],
            "node_id": r["node_id"],
            "node_title": r.get("title", ""),
            "status": r["status"],
            "requested_by": r.get("requested_by", ""),
            "requested_at": r.get("requested_at", ""),
            "approved_by": r.get("approved_by", "") or "",
            "approved_at": r.get("approved_at", "") or "",
            "resumed_at": r.get("resumed_at", "") or "",
            "completed_at": completed_at,
            "rejection_note": r.get("rejection_note") or "",
            "fallback_action": r.get("fallback_action") or "",
        }
        rows.append(row)
    return rows


def _escape_csv(val: str) -> str:
    if "," in val or '"' in val or "\n" in val or "\r" in val:
        return f'"{val.replace(chr(34), chr(34)+chr(34))}"'
    return val


@router.get("/run/{run_id}/export/json")
async def export_approvals_json(run_id: str):
    rows = _build_export_rows(run_id)
    return rows


@router.get("/run/{run_id}/export/csv", response_class=PlainTextResponse)
async def export_approvals_csv(run_id: str):
    rows = _build_export_rows(run_id)
    lines = [",".join(CSV_HEADERS)]
    for row in rows:
        lines.append(
            ",".join(_escape_csv(row.get(h, "")) for h in CSV_HEADERS)
        )
    return PlainTextResponse("\r\n".join(lines), media_type="text/csv")


@router.get("/{approval_id}", response_model=ApprovalResponse)
async def get_approval(approval_id: str):
    record = APPROVALS_DB.get(approval_id)
    if not record:
        raise HTTPException(status_code=404, detail="Approval not found")
    return _record_to_response(record)


@router.post("/{approval_id}/approve", response_model=ResumeResponse)
async def approve(approval_id: str, body: ApproveAction | None = None):
    record = APPROVALS_DB.get(approval_id)
    if not record:
        raise HTTPException(status_code=404, detail="Approval not found")
    if record["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Approval already {record['status']}")

    now = datetime.now(timezone.utc).isoformat()
    record["status"] = "approved"
    record["approved_by"] = body.approved_by if body else "operator"
    record["approved_at"] = now

    run = RUNS_DB.get(record["run_id"])
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    run["status"] = "running"
    try:
        return await _resume_execution(run)
    except HTTPException:
        raise
    except Exception as exc:
        run["status"] = "failed"
        return ResumeResponse(
            success=False, output=str(exc),
            logs=run.get("logs", []), status="failed",
            run_id=record["run_id"],
        )


@router.post("/{approval_id}/reject", response_model=ApprovalResponse)
async def reject(approval_id: str, body: ApproveAction | None = None):
    record = APPROVALS_DB.get(approval_id)
    if not record:
        raise HTTPException(status_code=404, detail="Approval not found")
    if record["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Approval already {record['status']}")

    now = datetime.now(timezone.utc).isoformat()
    record["status"] = "rejected"
    record["rejection_note"] = body.rejection_note if body else None
    record["approved_by"] = body.approved_by if body else "operator"
    record["approved_at"] = now

    run = RUNS_DB.get(record["run_id"])
    if run:
        run["status"] = "rejected"

    return _record_to_response(record)


def _topological_sort(nodes: list[WorkflowNode], edges: list[WorkflowEdge]) -> list[WorkflowNode]:
    in_degree: dict[str, int] = {n.id: 0 for n in nodes}
    adj: dict[str, list[str]] = {n.id: [] for n in nodes}
    for e in edges:
        if e.target in in_degree:
            in_degree[e.target] += 1
        if e.source in adj:
            adj[e.source].append(e.target)
    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    sorted_ids: list[str] = []
    while queue:
        current = queue.pop(0)
        sorted_ids.append(current)
        for neighbor in adj.get(current, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)
    id_to_node = {n.id: n for n in nodes}
    return [id_to_node[nid] for nid in sorted_ids if nid in id_to_node]


async def _resume_execution(run: dict[str, Any]) -> dict[str, Any]:
    nodes = [WorkflowNode(**n) for n in run["nodes"]]
    edges = [WorkflowEdge(**e) for e in run["edges"]]
    sorted_raw = run["sorted_nodes"]
    sorted_nodes = [WorkflowNode(**n) for n in sorted_raw]
    start_index = run["current_index"] + 1
    node_outputs: dict[str, Any] = dict(run.get("node_outputs", {}))
    logs: list[dict[str, Any]] = list(run.get("logs", []))
    step = run.get("step", 1)
    payload_value = run.get("payload", "")
    run_id = run["run_id"]
    workflow_id = run.get("workflow_id", "")

    approval_id = run.get("approval_id")
    now = datetime.now(timezone.utc).isoformat()

    if approval_id and approval_id in APPROVALS_DB:
        APPROVALS_DB[approval_id]["resumed_at"] = now

    from app.api.routes.workflow_triggers import _execute_nodes_range

    result = await _execute_nodes_range(
        nodes=nodes,
        edges=edges,
        sorted_nodes=sorted_nodes,
        start_index=start_index,
        node_outputs=node_outputs,
        logs=logs,
        step=step,
        payload_value=payload_value,
        run_id=run_id,
        workflow_id=workflow_id,
    )

    if result.get("paused"):
        return {
            "success": True,
            "output": "",
            "logs": result["logs"],
            "status": "paused_for_approval",
            "approval_id": result["approval_id"],
            "run_id": result["run_id"],
        }

    run["status"] = "completed"
    run["completed_at"] = now
    result_logs = result.get("logs", [])
    return {
        "success": True,
        "output": result.get("output", ""),
        "logs": result_logs,
        "status": "completed",
        "approval_id": None,
        "run_id": run_id,
    }


def _record_to_response(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "run_id": r["run_id"],
        "workflow_id": r["workflow_id"],
        "node_id": r["node_id"],
        "title": r["title"],
        "description": r["description"],
        "fallback_action": r.get("fallback_action"),
        "requested_by": r["requested_by"],
        "requested_at": r["requested_at"],
        "status": r["status"],
        "rejection_note": r.get("rejection_note"),
        "approved_by": r.get("approved_by"),
        "approved_at": r.get("approved_at"),
        "resumed_at": r.get("resumed_at"),
    }
