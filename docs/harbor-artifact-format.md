# Harbor Job Artifact Format

> Reference for developers integrating Harbor job outputs with AutoHarness Studio.

## What Harbor Produces

When you run:
```bash
harbor run --dataset terminal-bench@2.0 --agent oracle --jobs-dir ./harbor_jobs
```

Harbor creates a timestamped job directory under `./harbor_jobs/`:

```
harbor_jobs/
└── <job-name-or-timestamp>/        ← job_dir (root, parsed by ingester)
    ├── result.json                 ← global job summary (parsed)
    └── <trial-name>/               ← one per task (e.g. "nginx-port-clash")
        ├── result.json             ← trial result: task_id, score, status, category
        ├── agent/
        │   └── trajectory.json    ← agent message history (optional, parsed for TraceSteps)
        └── verifier/
            ├── reward.txt          ← "1" for PASS, "0" for FAIL (primary score source)
            └── ctrf.json           ← structured test report (optional)
```

## File Schemas

### `result.json` (job root)
```json
{
  "dataset": "terminal-bench@2.0",
  "agent": "oracle",
  "harness_version": "harbor-0.13.2",
  "label": "My run label",
  "total_trials": 10,
  "passed": 7,
  "failed": 3,
  "pass_rate": 0.70,
  "created_at": "2024-06-14T10:00:00Z"
}
```

### `<trial>/result.json`
```json
{
  "task": "nginx-port-clash",
  "task_id": "tb2-nginx-port-clash",
  "category": "networking",
  "difficulty": "medium",
  "status": "PASS",
  "score": 1.0,
  "description": "Fix the nginx port conflict on port 80."
}
```

### `<trial>/verifier/reward.txt`
Plain text, one line: `1` (PASS) or `0` (FAIL).  
This is the **primary score source** — takes precedence over `result.json.score`.

### `<trial>/agent/trajectory.json`
JSON array of message objects (OpenAI-style):
```json
[
  {"role": "system",    "content": "You are an agent..."},
  {"role": "assistant", "content": "I will check nginx status."},
  {"role": "tool_call", "content": "systemctl status nginx"},
  {"role": "tool_result", "content": "Active: failed..."},
  ...
]
```

Role mapping to AutoHarness Studio step types:

| Harbor role       | Studio `step_type` |
|-------------------|--------------------|
| `assistant`/`agent` | `ASSISTANT`       |
| `user`/`human`    | `USER`             |
| `system`          | `SYSTEM`           |
| `tool_call`/`command` | `TOOL_CALL`    |
| `tool`/`tool_result` | `TOOL_RESULT`   |
| anything else     | `LOG`              |

## Ingestion Idempotency

The ingester uses the **job directory name** as a stable `job_id` key.  
Re-running `dev_ingest.py` on the same directory is a no-op — the existing run is returned unchanged.

## Ingesting a Real Harbor Job

1. Run Harbor to produce a job directory
2. Use the dev ingest script:
   ```bash
   cd backend/
   python3 scripts/dev_ingest.py ./harbor_jobs/<your-job-dir>
   ```
3. Or POST to the API (once the server is running):
   ```bash
   curl -X POST http://localhost:8000/api/v1/jobs/harbor-rerun \
     -H "Content-Type: application/json" \
     -d '{"dataset": "terminal-bench@2.0", "agent": "oracle"}'
   ```
