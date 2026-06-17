# AutoHarness Studio

**Visual AI workflow builder with human-in-the-loop approval gates.** Build, validate, and execute multi-step pipelines — from simple text transforms to database queries, API calls, and local LLM inference — with built-in approval controls that pause execution, capture decisions, and export an audit trail.

---

## Feature Summary

- **Visual workflow builder** — drag-and-drop canvas (React Flow) with 8 node types: Input, Text, LLM, Logic, HTTP, Database, Approval, Output
- **Approval gates** — add an Approval node to any pipeline; execution pauses until approved or rejected
- **Approval history timeline** — every event (requested, approved, rejected, resumed, completed) rendered in a compact sidebar timeline with colored dots and icons
- **Audit export** — download approval history as JSON or CSV from the timeline header; backend serves `/approvals/run/{run_id}/export/json` and `/export/csv`
- **Resume-on-approve** — execution continues from the paused node after approval
- **Reject-with-note** — reject with an optional note; the pipeline stops and the audit trail records the decision and actor
- **Client-side + proxied execution** — Input/Text/Logic/Output run in-browser; LLM, HTTP, and Database nodes proxy through the FastAPI backend
- **Backward compatible** — pipelines without Approval nodes run uninterrupted

---

## Demo Story (90-second walkthrough)

1. **Open the app** → `http://localhost:3000/workflow` — the canvas loads with a sample Input → Text → LLM → Output pipeline
2. **Add an approval gate** → click the **Approval** button in the toolbar; a node appears — connect it between any two nodes (e.g. Text → Approval → LLM)
3. **Configure** → click the Approval node; in the properties panel, set a title ("Review prompt"), description ("Check before LLM call"), and optional fallback action
4. **Run** → click **Run Pipeline** — execution proceeds through non-approval nodes, then pauses at the gate
5. **Decide** → the sidebar shows an Approval panel with Approve / Reject buttons:
   - **Approve** → execution resumes, continues to the LLM and Output, and a green "approved" event joins the timeline
   - **Reject** → enter an optional note (e.g. "Prompt contains PII") and click Reject — the pipeline stops, the timeline records a red "rejected" event with the note
6. **Export** → after the run, click **Export** in the timeline header; choose JSON or CSV to download a complete audit log (approval ID, actor, timestamps, decision, note)
7. **Try repeated gates** → add multiple Approval nodes in sequence — each pauses independently; approve them one at a time and watch the timeline grow

---

## Architecture

```
Browser (Next.js / React Flow)
  ├── Client-side nodes: Input, Text, Logic, Output, Approval
  └── Proxied nodes: LLM, HTTP, Database
        └── API routes (localhost:3000/api/v1/…)
              └── FastAPI backend (localhost:8001)
                    ├── /ollama/generate    → Ollama (localhost:11434)
                    ├── /http/request       → External APIs
                    ├── /database/query     → SQLite / Postgres
                    └── /approvals/…        → In-memory approval store
```

**Key API endpoints:**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/workflows/direct/trigger` | Trigger a full pipeline run |
| `GET` | `/api/v1/approvals/run/{run_id}` | Approval history for a run |
| `POST` | `/api/v1/approvals/{id}/approve` | Approve and resume execution |
| `POST` | `/api/v1/approvals/{id}/reject` | Reject with optional note |
| `GET` | `/api/v1/approvals/run/{run_id}/export/json` | Export audit trail as JSON |
| `GET` | `/api/v1/approvals/run/{run_id}/export/csv` | Export audit trail as CSV |

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- (Optional) [Ollama](https://ollama.ai) — required for LLM nodes

### 1. Start the backend

```bash
cd backend
pip install -r requirements.txt
DATABASE_URL=sqlite:///./dev.db uvicorn app.main:app --port 8001
```

### 2. Start the frontend

```bash
# In a separate terminal
npm install
npm run dev
```

### 3. (Optional) Start Ollama

```bash
ollama serve
# Pull a model: ollama pull llama3.1:8b
```

### 4. Open the app

```
http://localhost:3000/workflow
```

---

## Demo Checklist

- [ ] Backend running — `curl http://localhost:8001/health`
- [ ] Frontend running — `http://localhost:3000/workflow`
- [ ] Ollama running with a model — `curl http://localhost:11434/api/tags`
- [ ] **Walkthrough**: add an Approval node, run the pipeline, approve it, export the audit CSV
- [ ] **Rejection flow**: add an Approval node, run, reject with a note, verify the timeline and export show the rejection
- [ ] **Multiple gates**: add two Approval nodes in sequence, approve the first, verify it pauses again at the second
- [ ] **Backward compat**: remove all Approval nodes, run — pipeline completes without interruption

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, React Flow 11, Tailwind CSS 4, TypeScript |
| Backend | FastAPI, SQLAlchemy, SQLite (default) / Postgres, Pydantic v2 |
| LLM | Ollama (local inference) |
| Language | Python 3.11+, TypeScript |

---

## Project Structure

```
backend/
  app/
    main.py               — FastAPI app, route registration
    api/routes/
      approvals.py        — Approval CRUD, pause/resume/reject, export
      workflow_triggers.py — Pipeline execution engine
      ollama.py           — LLM proxy
      http_requests.py    — External HTTP proxy
      database_proxy.py   — Database query proxy
src/
  app/workflow/page.tsx    — Main workflow builder page
  components/workflow/
    Canvas.tsx             — React Flow canvas
    nodes/                 — Node definitions (BaseNode, ApprovalNode, etc.)
    PropertiesPanel.tsx    — Node configuration panel
    ApprovalPanel.tsx      — Approve/reject UI
    ApprovalHistoryTimeline.tsx — Event timeline
    ApprovalExport.tsx     — JSON/CSV export dropdown
    TemplateSidebar.tsx    — Reusable workflow templates
  hooks/
    usePipelineExecution.ts — Client-side execution engine
```

---

## Export Data Format

Each export row contains:

| Column | Description |
|--------|-------------|
| `approval_id` | Unique approval identifier |
| `event` / `status` | Requested, approved, rejected, resumed, completed |
| `run_id` | Pipeline run identifier |
| `workflow_id` | Workflow identifier |
| `node_title` | The approval node's configured title |
| `actor` | Who performed the action (operator, admin, system) |
| `timestamp` | When the event occurred |
| `note` | Rejection note (if rejected) |
| `fallback_action` | Configured fallback (if any) |
