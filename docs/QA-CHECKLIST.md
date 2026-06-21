# Demo QA Checklist

## Prerequisites

- [ ] Backend running: `curl http://localhost:8001/health`
- [ ] Frontend running: `http://localhost:3000`
- [ ] Ollama running with a model: `curl http://localhost:11434/api/tags`
- [ ] Open in **incognito/private** window
- [ ] Open at **mobile width** (≤768px) as well
- [ ] Clear console (`console.clear()`) before each test run
- [ ] `npx tsc --noEmit` passes cleanly

---

## Success Path

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Navigate to `/workflow` | Canvas loads with Input→Text→LLM→Output pipeline | ☐ |
| 2 | Click **Run Pipeline** | Button shows spinner + "Executing..."; logs panel opens | ☐ |
| 3 | Observe execution | Input→Text→LLM nodes execute in sequence; logs stream | ☐ |
| 4 | Execution completes | Output node shows result; "Run Completed" in timeline | ☐ |
| 5 | Click **Export** → **CSV** | CSV file downloads with audit columns | ☐ |
| 6 | Check timeline | Shows "completed" entry with timestamp | ☐ |
| 7 | **Console: no errors** | No console errors during entire run | ☐ |

---

## Approval Path

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Add Approval node between Text and LLM | Approval node appears on canvas | ☐ |
| 2 | Connect Text→Approval→LLM | Edges connect successfully | ☐ |
| 3 | Click **Run Pipeline** | Execution pauses at Approval node | ☐ |
| 4 | See **Approval Required** panel | Sidebar shows approval panel with "Pending" badge | ☐ |
| 5 | Click **Approve** | Button shows spinner; execution resumes | ☐ |
| 6 | Pipeline completes | Output node shows final result | ☐ |
| 7 | Check timeline | Shows: requested → approved → resumed → completed | ☐ |
| 8 | Export CSV | File includes all 4 events | ☐ |
| 9 | **Console: no errors** | No console errors | ☐ |

---

## Rejection Path

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Run pipeline again | Execution pauses at Approval node | ☐ |
| 2 | Enter rejection note: "Test rejection" | Text appears in textarea | ☐ |
| 3 | Click **Reject** | Pipeline halts; no LLM call is made | ☐ |
| 4 | Check timeline | Shows: requested → rejected (with note) | ☐ |
| 5 | **LLM node never ran** | Verify logs show no LLM response | ☐ |
| 6 | Export **JSON** | File includes rejection note and timestamp | ☐ |
| 7 | **Console: no errors** | No console errors | ☐ |

---

## Security & RLS

| Step | Action | Expected Result | Pass/Fail |
|------|--------|----------------|-----------|
| 1 | Open browser DevTools → Network tab | All Supabase queries visible | ☐ |
| 2 | Public read: load `/runs` | Data loads without auth headers | ☐ |
| 3 | Attempt client-side write: `supabase.from('runs').insert(...)` | Blocked by RLS (401/403) | ☐ |
| 4 | Attempt client query on `jobs` table | Blocked (service_role only) | ☐ |
| 5 | Verify `jobs` table not exposed in client bundle | No `jobs` references in browser sources | ☐ |

---

## Regression Checks

| Check | Expected Result | Pass/Fail |
|-------|----------------|-----------|
| **Hard refresh** (Cmd+Shift+R) at `/workflow` | Canvas loads correctly; no blank panels | ☐ |
| **Fresh browser** (incognito) full test | All paths work without prior state | ☐ |
| **Mobile width** (≤768px) | Sidebar bottom sheet works; panels responsive | ☐ |
| **No duplicate events** | Each `workflow_run_completed` fires exactly once | ☐ |
| **Stale approval state** | After reject → Run again → no stale UI state | ☐ |
| **Empty state: history** | Timeline panel not shown when no entries | ☐ |
| **Empty state: export** | Export button disabled when no entries | ☐ |
| **Export both formats** | CSV and JSON both produce valid downloadable files | ☐ |
| **Backward compat** (no approval node) | Pipeline runs uninterrupted | ☐ |
| **Multiple gates** (2 approval nodes) | Pauses at each; approves in sequence | ☐ |

---

## Pre-demo Runbook (freeze order)

1. ☐ `npx tsc --noEmit`
2. ☐ `npm run lint`
3. ☐ Open app fresh (incognito)
4. ☐ Test success path
5. ☐ Test rejection path
6. ☐ Export CSV + JSON
7. ☐ Check timeline/history
8. ☐ Verify analytics fire once
9. ☐ Verify Supabase RLS
10. ☐ Rehearse spoken demo once
11. ☐ **Freeze** — no code changes after this point
