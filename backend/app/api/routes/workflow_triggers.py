from __future__ import annotations

import re
import uuid
from collections import defaultdict
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.routes.http_request import _validate_url, _parse_body
from app.api.routes.database import _serialize_rows
from app.db.session import SessionLocal

from datetime import datetime, timezone

from app.api.routes.approvals import RUNS_DB, create_approval, APPROVALS_DB, CreateApprovalRequest

router = APIRouter(prefix="/workflows", tags=["workflows"])

WORKFLOWS_DB: dict[str, dict[str, Any]] = {}

JsonPrimitive = str | int | float | bool | None
JsonValue = JsonPrimitive | list[Any] | dict[str, Any]


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


class TriggerRequest(BaseModel):
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    payload: JsonValue = ""


class TriggerResponse(BaseModel):
    success: bool
    output: str
    logs: list[dict[str, Any]]
    status: str = "completed"
    approval_id: str | None = None
    run_id: str | None = None
    approval_title: str | None = None
    approval_description: str | None = None


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


async def _execute_nodes_range(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    sorted_nodes: list[WorkflowNode],
    start_index: int,
    node_outputs: dict[str, Any],
    logs: list[dict[str, Any]],
    step: int,
    payload_value: JsonValue,
    run_id: str,
    workflow_id: str,
) -> dict[str, Any]:
    def add_log(node_id: str, node_type: str, message: str):
        nonlocal step
        logs.append({"step": step, "nodeId": node_id, "nodeType": node_type, "message": message})
        step += 1

    for i in range(start_index, len(sorted_nodes)):
        node = sorted_nodes[i]
        node_type = node.type
        node_data = node.data
        params = node_data.get("params", {}) or {}

        incoming_edges = [e for e in edges if e.target == node.id]
        inputs: dict[str, Any] = {}

        for e in incoming_edges:
            source_output = node_outputs.get(e.source)
            if e.targetHandle and e.targetHandle.startswith("var:"):
                var_name = e.targetHandle.replace("var:", "")
                inputs[var_name] = source_output
            else:
                if "default" not in inputs:
                    inputs["default"] = []
                inputs["default"].append(source_output)

        node_output: Any = None

        if node_type == "input":
            node_output = str(payload_value) if payload_value else (params.get("inputValue") or "")
            add_log(node.id, "Input", f"value: '{node_output}'")

        elif node_type == "text":
            text_content = str(params.get("text") or "")
            for key, value in inputs.items():
                if key == "default":
                    val_str = ", ".join(str(v) for v in value) if isinstance(value, list) else str(value or "")
                    text_content = text_content.replace("{{ default }}", val_str)
                else:
                    val_str = ", ".join(str(v) for v in value) if isinstance(value, list) else str(value or "")
                    text_content = text_content.replace("{{ " + key + " }}", val_str)
            node_output = text_content
            add_log(node.id, "Text", f"output: '{text_content[:80]}'")

        elif node_type == "llm":
            prompt = ""
            if "default" in inputs and isinstance(inputs["default"], list) and inputs["default"]:
                prompt = "\n".join(str(v) for v in inputs["default"])
            else:
                prompt = str(params.get("prompt") or "")

            model = str(params.get("model") or "llama3.1:8b")
            temperature = float(params.get("temperature") or 0.7)

            add_log(node.id, "LLM", f"Calling {model}")
            async with httpx.AsyncClient(base_url="http://localhost:11434", timeout=60.0) as client:
                llm_payload = {
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": temperature},
                }
                llm_resp = await client.post("/api/generate", json=llm_payload)
                llm_resp.raise_for_status()
                llm_data = llm_resp.json()
                node_output = llm_data.get("response", "")
            add_log(node.id, "LLM", f"response: '{str(node_output)[:80]}'")

        elif node_type == "http":
            method = str(params.get("method") or "GET").upper()
            url = str(params.get("url") or "")
            headers_str = str(params.get("headers") or "{}")

            if not url:
                raise HTTPException(status_code=400, detail="HTTP node requires a URL")

            try:
                headers_dict = dict[str, str]()
                if headers_str.strip():
                    parsed_h = __import__("json").loads(headers_str)
                    if isinstance(parsed_h, dict):
                        headers_dict = {k: str(v) for k, v in parsed_h.items()}
            except (ValueError, TypeError):
                headers_dict = {}

            body_str = str(params.get("body") or "")
            request_body = None
            if method in ("POST", "PUT") and body_str.strip():
                try:
                    request_body = __import__("json").loads(body_str)
                except (ValueError, TypeError):
                    request_body = body_str

            add_log(node.id, "HTTP", f"Calling {method} {url}")
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                http_resp = await client.request(
                    method=method, url=url, headers=headers_dict,
                    json=request_body if method in ("POST", "PUT") else None,
                )
                http_resp.raise_for_status()
                content_type = http_resp.headers.get("content-type", "")
                if "application/json" in content_type:
                    node_output = http_resp.json()
                else:
                    node_output = http_resp.text
            add_log(node.id, "HTTP", f"Status: {http_resp.status_code}")

        elif node_type == "database":
            query = str(params.get("query") or "")
            query_type = str(params.get("queryType") or "SELECT").upper()
            table_name = str(params.get("tableName") or "")

            db_params_str = str(params.get("dbParams") or "{}")
            try:
                db_params = __import__("json").loads(db_params_str) if db_params_str.strip() else {}
            except (ValueError, TypeError):
                db_params = {}

            if not query:
                raise HTTPException(status_code=400, detail="Database node requires a SQL query")

            add_log(node.id, "Database", f"Executing {query_type}")

            db = SessionLocal()
            try:
                result = db.execute(text(query), db_params if isinstance(db_params, dict) else {})
                rows = _serialize_rows(result)
                rows_affected = 0
                if result.rowcount is not None and result.rowcount >= 0:
                    rows_affected = result.rowcount
                if not result.returns_rows:
                    db.commit()
                node_output = rows
                add_log(node.id, "Database", f"Returned {len(rows)} rows")
            except SQLAlchemyError as exc:
                db.rollback()
                raise HTTPException(status_code=500, detail=f"Database query failed: {exc}")
            finally:
                db.close()

        elif node_type == "logic":
            node_output = True
            add_log(node.id, "Logic", "evaluated to: True")

        elif node_type == "approval":
            title = str(params.get("title") or "Approval Required")
            description = str(params.get("description") or "This step requires manual approval before continuing.")
            fallback_action = str(params.get("fallbackAction") or "") or None

            approval = create_approval(CreateApprovalRequest(
                run_id=run_id,
                workflow_id=workflow_id,
                node_id=node.id,
                title=title,
                description=description,
                fallback_action=fallback_action,
            ))

            approval_entry = {"approval_id": approval["id"], "status": "paused"}
            if "default" in inputs and isinstance(inputs["default"], list) and inputs["default"]:
                node_output = inputs["default"][0]
            else:
                node_output = approval_entry

            node_outputs[node.id] = node_output
            add_log(node.id, "Approval", f"Paused: {title}")

            RUNS_DB[run_id] = {
                "run_id": run_id,
                "workflow_id": workflow_id,
                "status": "paused_for_approval",
                "nodes": [n.model_dump() for n in nodes],
                "edges": [e.model_dump() for e in edges],
                "sorted_nodes": [n.model_dump() for n in sorted_nodes],
                "current_index": i,
                "node_outputs": dict(node_outputs),
                "logs": list(logs),
                "step": step,
                "payload": payload_value,
                "approval_id": approval["id"],
            }

            return {
                "paused": True,
                "approval_id": approval["id"],
                "run_id": run_id,
                "approval_title": title,
                "approval_description": description,
                "logs": list(logs),
            }

        elif node_type == "output":
            if "default" in inputs and isinstance(inputs["default"], list) and inputs["default"]:
                node_output = "\n---\n".join(str(v) for v in inputs["default"])
            else:
                node_output = ""
            add_log(node.id, "Output", "collected inputs")

        node_outputs[node.id] = node_output

    final_output = ""
    output_nodes = [n for n in sorted_nodes if n.type == "output"]
    if output_nodes:
        last_output = output_nodes[-1]
        final_output = str(node_outputs.get(last_output.id, ""))

    return {
        "paused": False,
        "success": True,
        "output": final_output,
        "logs": list(logs),
    }


@router.post("/register")
async def register_workflow(payload: dict[str, Any]):
    workflow_id = str(uuid.uuid4())[:8]
    WORKFLOWS_DB[workflow_id] = payload
    return {"ok": True, "id": workflow_id}


@router.post("/{workflow_id}/trigger", response_model=TriggerResponse)
async def trigger_workflow(workflow_id: str, body: TriggerRequest | None = None):
    stored = WORKFLOWS_DB.get(workflow_id)
    body_has_nodes = body and body.nodes
    if stored and not body_has_nodes:
        nodes_data = stored.get("nodes", [])
        edges_data = stored.get("edges", [])
        payload_value = body.payload if body else stored.get("payload", "")
    elif body_has_nodes:
        nodes_data = [n.model_dump() for n in body.nodes]
        edges_data = [e.model_dump() for e in body.edges]
        payload_value = body.payload
    elif stored:
        nodes_data = stored.get("nodes", [])
        edges_data = stored.get("edges", [])
        payload_value = stored.get("payload", "")
    else:
        raise HTTPException(status_code=404, detail="Workflow not found")

    nodes = [WorkflowNode(**n) for n in nodes_data]
    edges = [WorkflowEdge(**e) for e in edges_data]

    if not nodes:
        raise HTTPException(status_code=400, detail="Workflow has no nodes")

    sorted_nodes = _topological_sort(nodes, edges)
    if len(sorted_nodes) != len(nodes):
        raise HTTPException(status_code=400, detail="Cycle detected in workflow graph")

    run_id = str(uuid.uuid4())[:8]
    node_outputs: dict[str, Any] = {}
    logs: list[dict[str, Any]] = []
    step = 1

    try:
        result = await _execute_nodes_range(
            nodes=nodes,
            edges=edges,
            sorted_nodes=sorted_nodes,
            start_index=0,
            node_outputs=node_outputs,
            logs=logs,
            step=step,
            payload_value=payload_value,
            run_id=run_id,
            workflow_id=workflow_id,
        )

        if result.get("paused"):
            return TriggerResponse(
                success=True,
                output="",
                logs=result["logs"],
                status="paused_for_approval",
                approval_id=result["approval_id"],
                run_id=result["run_id"],
                approval_title=result.get("approval_title"),
                approval_description=result.get("approval_description"),
            )

        now = datetime.now(timezone.utc).isoformat()
        RUNS_DB[run_id] = {
            "run_id": run_id,
            "workflow_id": workflow_id,
            "status": "completed",
            "completed_at": now,
            "nodes": nodes_data,
            "edges": edges_data,
            "logs": list(logs),
        }

        return TriggerResponse(
            success=True,
            output=result.get("output", ""),
            logs=result["logs"],
            status="completed",
        )

    except HTTPException:
        raise
    except Exception as exc:
        logs.append({"step": step, "nodeId": "system", "nodeType": "System", "message": f"Error: {exc}"})
        return TriggerResponse(success=False, output=str(exc), logs=logs, status="failed")
