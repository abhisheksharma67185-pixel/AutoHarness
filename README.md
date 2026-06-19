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
- **Production Row Level Security (RLS)** — Row-Level Security enabled on all 6 database tables in Supabase with public read-only policies and strict default-deny write control.
- **Advanced PostHog Analytics** — captures typed custom event properties (decision source, run context, node types), measures time-to-decision (`time_to_approval_ms`), and tracks custom conversion funnels.


---

## Demo Story (90-second walkthrough)

1. **Open the app** → `http://localhost:3000/workflow` — the canvas loads with a sample Input → Text → LLM → Output pipeline.
2. **Add an approval gate** → click the **Approval** button in the toolbar; a node appears — connect it between the Text and LLM nodes.
3. **Configure** → click the Approval node; in the properties panel, set a title ("Review prompt"), description ("Check before LLM call"), and optional fallback action.
4. **Choose your demo path**:
   * **Clean Success Path**:
     * Run the pipeline, and observe the execution pause at the approval gate.
     * Click **Approve** in the sidebar panel.
     * Let the workflow complete fully, and export the CSV showing the approved event in the audit log.
   * **Failure / Rejection Path**:
     * Run the pipeline, and observe the execution pause at the approval gate.
     * Click **Reject** in the sidebar panel, entering the note: `"Prompt injection detected"`.
     * Verify that the LLM node never runs (pipeline halts immediately), and export the JSON showing the rejected event, timestamp, and rejection note.


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
                    ├── /database/query     → Postgres (Supabase)
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
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/autoharness uvicorn app.main:app --port 8001
```

> **Note:** The backend now requires a PostgreSQL database. Use your Supabase connection string for production, or a local Postgres for development.

### 2. Start the frontend

Set up your environment variables in `.env`:

```env
# PostHog Analytics
NEXT_PUBLIC_POSTHOG_KEY=your_posthog_project_api_key
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-secret-service-role-key
```


Then run the setup commands:

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
| Backend | FastAPI, SQLAlchemy, Supabase PostgreSQL, Pydantic v2 |
| Security | Row Level Security (RLS) policies, Two-Key Supabase clients (Anon/Service-Role) |
| Analytics | PostHog (custom event properties, funnel, and decision time tracking) |
| LLM | Ollama (local inference) |
| Language | Python 3.11+, TypeScript |


---

## Project Structure

```
supabase/
  migrations/
    001_enable_rls.sql    — SQL schema setup and RLS policy definition
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
  lib/
    supabase-server.ts     — Highly privileged server-side Supabase client
    supabase-browser.ts    — Secure browser-side Supabase client
  hooks/
    usePipelineExecution.ts — Client-side execution engine
docs/
  supabase-rls.md         — Core documentation of the RLS security architecture

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
