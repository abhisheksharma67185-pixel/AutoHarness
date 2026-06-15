#!/usr/bin/env python3
"""
seed_dev_db.py — Seed the backend dev database dev.db.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from datetime import datetime

# Add backend/ to sys.path so app imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.base import Base
from app.db.session import engine, SessionLocal
from app.domain.models import (
    Run, RunTask, TraceStep, FailureLabel, FailureMode, FailureModeMember,
    EvalSuite, EvalCase, EvalRun, Experiment, ExperimentVariant
)

TASKS_DATA = [
  {
    "task_id": "tb-task-01",
    "slug": "nginx-port-clash",
    "category": "Web Administration",
    "difficulty": "Medium",
    "description": "Find why nginx fails to start on the target container, resolve any port binding clashes, and start the service."
  },
  {
    "task_id": "tb-task-02",
    "slug": "git-rebase-conflict",
    "category": "Version Control",
    "difficulty": "Hard",
    "description": "Run git rebase origin/main on the feature branch, resolve any conflict markers inside lib/core.py, and finish the rebase."
  },
  {
    "task_id": "tb-task-03",
    "slug": "parse-server-logs",
    "category": "Data Processing",
    "difficulty": "Easy",
    "description": "Write a script or pipeline to extract all HTTP 500 error logs from /var/log/nginx/access.log, group them by path, and save to /tmp/report.json."
  },
  {
    "task_id": "tb-task-04",
    "slug": "db-migration-failure",
    "category": "Database Management",
    "difficulty": "Hard",
    "description": "Run the Alembic database migrations. Identify why migration 4fa2bc fails, edit the migration code to fix the column type mismatch, and run it again."
  },
  {
    "task_id": "tb-task-05",
    "slug": "docker-build-missing-dep",
    "category": "DevOps",
    "difficulty": "Medium",
    "description": "Build the local docker image from Dockerfile. If packages are missing during the build phase, update the docker file to install them beforehand."
  },
  {
    "task_id": "tb-task-06",
    "slug": "fetch-api-timeout",
    "category": "Network Operations",
    "difficulty": "Easy",
    "description": "Query the internal service API at http://10.0.5.11:8080/health, check if it is active, and configure automatic retries."
  },
  {
    "task_id": "tb-task-07",
    "slug": "restricted-sudo-write",
    "category": "Security",
    "difficulty": "Medium",
    "description": "Verify the integrity of /etc/hosts and add a new hostname mapping pointing local.dev to 127.0.0.1."
  },
  {
    "task_id": "tb-task-08",
    "slug": "disk-cleanup-logs",
    "category": "System Diagnostics",
    "difficulty": "Easy",
    "description": "Locate logs taking up excessive space under /var/log and clear rotated files ending in .gz older than 7 days."
  },
  {
    "task_id": "tb-task-09",
    "slug": "backup-config-ambiguity",
    "category": "Configuration Management",
    "difficulty": "Medium",
    "description": "Locate the backup configuration file in the project, set backup_interval to 3600, and save it."
  },
  {
    "task_id": "tb-task-10",
    "slug": "cron-job-setup",
    "category": "System Diagnostics",
    "difficulty": "Easy",
    "description": "Configure a cron job that executes /usr/local/bin/cleanup.sh every night at 2:00 AM and forwards logs."
  }
]

RUN1_DATA = {
  "run_id": "run-tb2-baseline",
  "agent_name": "SigmaAgent v1.2",
  "harness_version": "v1.0.0",
  "run_label": "Baseline Ingestion Run",
  "raw_artifact_uri": "public/demo/runs/baseline.json",
  "tasks": [
    {
      **TASKS_DATA[0],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "I need to check why nginx fails to start. I will run systemctl status nginx." },
        { "step_index": 1, "type": "tool_call", "content": "systemctl status nginx" },
        { "step_index": 2, "type": "tool_output", "output": "nginx.service - A high performance web server and reverse proxy\nActive: failed\nError: bind() to 0.0.0.0:80 failed (Address already in use)" },
        { "step_index": 3, "type": "agent", "content": "Ah, port 80 is already in use. Let me check what process is binding port 80." },
        { "step_index": 4, "type": "tool_call", "content": "ss -tulpn | grep :80" },
        { "step_index": 5, "type": "tool_output", "output": "tcp   LISTEN 0      511          0.0.0.0:80        0.0.0.0:*      users:((\"apache2\",pid=912,fd=4))" },
        { "step_index": 6, "type": "agent", "content": "Apache is running on port 80. I will stop apache2 and start nginx." },
        { "step_index": 7, "type": "tool_call", "content": "systemctl stop apache2 && systemctl start nginx" },
        { "step_index": 8, "type": "tool_output", "output": "Stopping apache2... Done\nStarting nginx... Done" },
        { "step_index": 9, "type": "agent", "content": "Nginx started successfully. Task complete!" }
      ]
    },
    {
      **TASKS_DATA[1],
      "success": False,
      "score": 0.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "I will start the git rebase." },
        { "step_index": 1, "type": "tool_call", "content": "git rebase origin/main" },
        { "step_index": 2, "type": "tool_output", "output": "CONFLICT (content): Merge conflict in lib/core.py\nResolve all conflicts manually." },
        { "step_index": 3, "type": "agent", "content": "Let me view conflict markers." },
        { "step_index": 4, "type": "tool_call", "content": "cat lib/core.py" },
        { "step_index": 5, "type": "tool_output", "output": "<<<<<<< HEAD\ndef get_score(self):\n    return self.score * 100\n=======\ndef get_score(self):\n    return self.base_score + self.delta\n>>>>>>> feature/scores" },
        { "step_index": 6, "type": "agent", "content": "I need to edit this file. I will use the edit tool but with wrong parameters." },
        { "step_index": 7, "type": "tool_call", "content": "replace_in_file \"lib/core.py\" \"<<<<<<< HEAD\" \"def get_score(self):\n    return self.base_score + self.delta\"" },
        { "step_index": 8, "type": "tool_output", "output": "Error: Cannot find substring. The replace command is missing end line block constraints." },
        { "step_index": 9, "type": "agent", "content": "Oops. I will try running git rebase --abort." },
        { "step_index": 10, "type": "tool_call", "content": "git rebase --abort" },
        { "step_index": 11, "type": "tool_output", "output": "Rebase aborted." }
      ]
    },
    {
      **TASKS_DATA[2],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "I will search for HTTP 500 error lines in the logs." },
        { "step_index": 1, "type": "tool_call", "content": "awk '$9 == 500 {print $7}' /var/log/nginx/access.log | sort | uniq -c" },
        { "step_index": 2, "type": "tool_output", "output": "  12 /api/v1/users\n  45 /api/v1/auth/login" },
        { "step_index": 3, "type": "agent", "content": "Great, now I will format this as a JSON file." },
        { "step_index": 4, "type": "tool_call", "content": "echo '{\"/api/v1/users\": 12, \"/api/v1/auth/login\": 45}' > /tmp/report.json" },
        { "step_index": 5, "type": "tool_output", "output": "" },
        { "step_index": 6, "type": "agent", "content": "Report generated successfully." }
      ]
    },
    {
      **TASKS_DATA[3],
      "success": False,
      "score": 0.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "I will run alembic migrations." },
        { "step_index": 1, "type": "tool_call", "content": "alembic upgrade head" },
        { "step_index": 2, "type": "tool_output", "output": "Traceback (most recent call last):\n  File \"alembic/versions/4fa2bc_migration.py\", line 22, in upgrade\n    op.alter_column('orders', 'price', type_=sa.Integer())\nTypeError: alter_column() missing required argument \"existing_type\"" },
        { "step_index": 3, "type": "agent", "content": "Ah, the python Alembic script itself crashed due to a TypeError." }
      ]
    },
    {
      **TASKS_DATA[4],
      "success": False,
      "score": 0.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "I will try to build the Docker image." },
        { "step_index": 1, "type": "tool_call", "content": "docker build -t app:latest ." },
        { "step_index": 2, "type": "tool_output", "output": "sh: docker: command not found" }
      ]
    },
    {
      **TASKS_DATA[5],
      "success": False,
      "score": 0.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "I will check connection to http://10.0.5.11:8080/health." },
        { "step_index": 1, "type": "tool_call", "content": "curl -I http://10.0.5.11:8080/health" },
        { "step_index": 2, "type": "tool_output", "output": "curl: (7) Failed to connect to 10.0.5.11 port 8080: Connection timed out" }
      ]
    },
    {
      **TASKS_DATA[6],
      "success": False,
      "score": 0.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "I will append a line to /etc/hosts." },
        { "step_index": 1, "type": "tool_call", "content": "echo \"127.0.0.1 local.dev\" >> /etc/hosts" },
        { "step_index": 2, "type": "tool_output", "output": "sh: /etc/hosts: Permission denied" }
      ]
    },
    {
      **TASKS_DATA[7],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Let me find .gz logs." },
        { "step_index": 1, "type": "tool_call", "content": "find /var/log -name \"*.gz\" -delete" }
      ]
    },
    {
      **TASKS_DATA[8],
      "success": False,
      "score": 0.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "I need to locate the backup configuration." },
        { "step_index": 1, "type": "tool_call", "content": "find . -name \"*backup*\"" },
        { "step_index": 2, "type": "tool_output", "output": "./config/backup.yaml\n./config/backup-prod.json" },
        { "step_index": 3, "type": "agent", "content": "Multiple backup files. I will update backup.yaml only." },
        { "step_index": 4, "type": "tool_call", "content": "echo \"backup_interval: 3600\" >> ./config/backup.yaml" }
      ]
    },
    {
      **TASKS_DATA[9],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Let me write the cron job." },
        { "step_index": 1, "type": "tool_call", "content": "crontab -l 2>/dev/null; echo \"0 2 * * * /usr/local/bin/cleanup.sh\"" }
      ]
    }
  ]
}

RUN2_DATA = {
  "run_id": "run-tb2-variant-1",
  "agent_name": "SigmaAgent v1.2",
  "harness_version": "v1.0.0-var-1",
  "run_label": "Harness Experiment Candidate 1 Run",
  "raw_artifact_uri": "public/demo/runs/improved.json",
  "tasks": [
    {
      **TASKS_DATA[0],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Check nginx." },
        { "step_index": 1, "type": "tool_call", "content": "systemctl stop apache2 && systemctl start nginx" },
        { "step_index": 2, "type": "tool_output", "output": "Stopping apache2... Done\nStarting nginx... Done" }
      ]
    },
    {
      **TASKS_DATA[1],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Start git rebase." },
        { "step_index": 1, "type": "tool_call", "content": "git rebase origin/main" },
        { "step_index": 2, "type": "tool_output", "output": "CONFLICT in lib/core.py..." },
        { "step_index": 3, "type": "agent", "content": "Pick correct rebase branch." },
        { "step_index": 4, "type": "tool_call", "content": "echo \"def get_score(self):\n    return self.base_score + self.delta\" > lib/core.py" },
        { "step_index": 5, "type": "tool_output", "output": "" },
        { "step_index": 6, "type": "tool_call", "content": "git add lib/core.py && git rebase --continue" },
        { "step_index": 7, "type": "tool_output", "output": "Successfully rebased." }
      ]
    },
    {
      **TASKS_DATA[2],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Writing report logs." },
        { "step_index": 1, "type": "tool_call", "content": "echo '{\"/api/v1/users\": 12}' > /tmp/report.json" }
      ]
    },
    {
      **TASKS_DATA[3],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Fix migration." },
        { "step_index": 1, "type": "tool_call", "content": "sed -i \"\" \"s/op.alter_column('orders', 'price', type_=sa.Integer())/op.alter_column('orders', 'price', type_=sa.Integer(), existing_type=sa.String())/g\" alembic/versions/4fa2bc_migration.py" },
        { "step_index": 2, "type": "tool_output", "output": "" },
        { "step_index": 3, "type": "tool_call", "content": "alembic upgrade head" },
        { "step_index": 4, "type": "tool_output", "output": "Migration successful." }
      ]
    },
    {
      **TASKS_DATA[4],
      "success": False,
      "score": 0.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Running docker build." },
        { "step_index": 1, "type": "tool_call", "content": "docker build -t app:latest ." },
        { "step_index": 2, "type": "tool_output", "output": "sh: docker: command not found" }
      ]
    },
    {
      **TASKS_DATA[5],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Query endpoint." },
        { "step_index": 1, "type": "tool_call", "content": "curl -I http://10.0.5.11:8080/health" },
        { "step_index": 2, "type": "tool_output", "output": "HTTP/1.1 200 OK" }
      ]
    },
    {
      **TASKS_DATA[6],
      "success": False,
      "score": 0.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Try writing hosts file." },
        { "step_index": 1, "type": "tool_call", "content": "echo \"127.0.0.1 local.dev\" >> /etc/hosts" },
        { "step_index": 2, "type": "tool_output", "output": "Permission denied" }
      ]
    },
    {
      **TASKS_DATA[7],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Delete old logs." },
        { "step_index": 1, "type": "tool_call", "content": "find /var/log -name \"*.gz\" -delete" }
      ]
    },
    {
      **TASKS_DATA[8],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Update configs to solve ambiguity." },
        { "step_index": 1, "type": "tool_call", "content": "echo \"backup_interval: 3600\" >> ./config/backup.yaml" },
        { "step_index": 2, "type": "tool_output", "output": "" },
        { "step_index": 3, "type": "tool_call", "content": "echo '{\"backup_interval\": 3600}' > ./config/backup-prod.json" },
        { "step_index": 4, "type": "tool_output", "output": "" }
      ]
    },
    {
      **TASKS_DATA[9],
      "success": True,
      "score": 1.0,
      "steps": [
        { "step_index": 0, "type": "agent", "content": "Register cron." },
        { "step_index": 1, "type": "tool_call", "content": "crontab -l" }
      ]
    }
  ]
}

def seed_run(db, payload, harness_version):
    run_id = payload["run_id"]
    agent_name = payload["agent_name"]
    raw_artifact_uri = payload["raw_artifact_uri"]
    
    # Calculate score metrics
    passed_tasks = sum(1 for t in payload["tasks"] if t["success"])
    total_tasks = len(payload["tasks"])
    global_score = passed_tasks / total_tasks if total_tasks > 0 else 0.0
    
    taxonomy_dist = {}
    category_scores = {}
    category_counts = {}
    
    for t in payload["tasks"]:
        category = t["category"]
        score = t["score"]
        if category not in category_scores:
            category_scores[category] = 0.0
            category_counts[category] = 0
        category_scores[category] += score
        category_counts[category] += 1
        
    avg_category_scores = {k: v / category_counts[k] for k, v in category_scores.items()}
    
    # Run
    run = Run(
        id=run_id,
        benchmark_slug="terminal-bench@2.0",
        run_label=payload["run_label"],
        agent_name=agent_name,
        harness_version=harness_version,
        status="completed",
        global_score=global_score,
        raw_artifact_uri=raw_artifact_uri,
        created_at=datetime.utcnow()
    )
    db.add(run)
    db.flush()
    
    # Tasks and trace steps
    for t in payload["tasks"]:
        rt_id = f"{run_id}_{t['task_id']}"
        run_task = RunTask(
            id=rt_id,
            run_id=run_id,
            benchmark_task_id=t["task_id"],
            task_slug=t["slug"],
            category=t["category"],
            difficulty=t["difficulty"],
            status="PASS" if t["success"] else "FAIL",
            score=t["score"],
            raw_task={"description": t["description"]},
            started_at=datetime.utcnow(),
            finished_at=datetime.utcnow()
        )
        db.add(run_task)
        db.flush()
        
        # steps
        for step in t["steps"]:
            step_index = step["step_index"]
            raw_type = step["type"]
            content = step.get("content") or step.get("output") or ""
            
            # map step_type
            if raw_type == "agent":
                step_type = "assistant"
            elif raw_type in ("tool_call", "command"):
                step_type = "tool_call"
            elif raw_type in ("tool_output", "stdout", "stderr"):
                step_type = "tool_result"
            elif raw_type == "system":
                step_type = "system"
            elif raw_type == "user":
                step_type = "user"
            else:
                step_type = "log"
                
            ts = TraceStep(
                run_task_id=rt_id,
                step_index=step_index,
                step_type=step_type,
                content=content,
                metadata_json={}
            )
            db.add(ts)
            
        # failure label
        if not t["success"]:
            taxonomy = "tool_misuse"
            diagnosis = "Tool parameter syntax error occurred during execution."
            
            if t["task_id"] == "tb-task-02":
                taxonomy = "tool_misuse"
                diagnosis = "Agent called git replace_in_file with wrong parameter block bounds."
            elif t["task_id"] == "tb-task-04":
                taxonomy = "code_bug"
                diagnosis = "Alembic migration script crashed with TypeError: alter_column() missing existing_type."
            elif t["task_id"] == "tb-task-05":
                taxonomy = "gap"
                diagnosis = "System is missing the docker command executable; docker build is not supported."
            elif t["task_id"] == "tb-task-06":
                taxonomy = "upstream"
                diagnosis = "Target IP 10.0.5.11 did not respond; connection timed out."
            elif t["task_id"] == "tb-task-07":
                taxonomy = "safety"
                diagnosis = "Writing to /etc/hosts failed due to blocked sudo command permissions."
            elif t["task_id"] == "tb-task-09":
                taxonomy = "ambiguity"
                diagnosis = "Multiple backup configurations existed; agent edited backup.yaml instead of backup-prod.json."
                
            taxonomy_dist[taxonomy] = taxonomy_dist.get(taxonomy, 0) + 1
            
            fl_id = f"fl_{run_id}_{t['task_id']}"
            fl = FailureLabel(
                id=fl_id,
                run_id=run_id,
                run_task_id=rt_id,
                diagnosis_text=diagnosis,
                taxonomy_primary=taxonomy,
                severity="critical" if taxonomy == "safety" else ("high" if taxonomy in ("code_bug", "ambiguity") else "medium"),
                confidence="high",
                prompt_version="diag_v1",
                model_version="llama3-8b",
                llm_latency_ms=120,
                raw_response={}
            )
            db.add(fl)
            
    # set metrics JSON
    metrics = {
        "total_tasks": total_tasks,
        "passed_tasks": passed_tasks,
        "failed_tasks": total_tasks - passed_tasks,
        "pass_rate": global_score,
        "avg_score": global_score,
        "category_scores": avg_category_scores,
        "taxonomy_distribution": taxonomy_dist
    }
    run.metrics = metrics
    db.commit()

def main():
    print("Seeding backend/dev.db...")
    # Drop and recreate tables to ensure clean state
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # 1. Seed Runs
        seed_run(db, RUN1_DATA, "v1.0.0")
        seed_run(db, RUN2_DATA, "v1.0.0-var-1")
        
        # 2. Seed Failure Modes
        fmodes = [
          { "id": "fm1", "name": "Git Rebase and File Conflict Failures", "desc": "Errors resolving merge conflicts in file markers, including syntax bounds checks.", "tax": "tool_misuse", "sev": "medium" },
          { "id": "fm2", "name": "Python alembic TypeError Exceptions", "desc": "Indentation, missing arguments, or runtime syntax exceptions in Alembic python migration scripts.", "tax": "code_bug", "sev": "high" },
          { "id": "fm3", "name": "Docker CLI Utility Capability Gap", "desc": "Missing docker package in environment, preventing execution of builds and container orchestration.", "tax": "gap", "sev": "medium" },
          { "id": "fm4", "name": "Upstream connection timeouts", "desc": "Connection timed out trying to reach internal endpoints or database hosts.", "tax": "upstream", "sev": "low" },
          { "id": "fm5", "name": "Blocked system config updates", "desc": "Host permission denied writing to /etc/hosts due to security/sudo policy blocks.", "tax": "safety", "sev": "critical" },
          { "id": "fm6", "name": "Ambiguous config file targets", "desc": "Multiple candidate files matched the instructions, leading the agent to update local instead of production configuration.", "tax": "ambiguity", "sev": "medium" }
        ]
        
        for fm in fmodes:
            fmode = FailureMode(
                id=fm["id"],
                benchmark_slug="terminal-bench@2.0",
                name=fm["name"],
                description=fm["desc"],
                taxonomy_primary=fm["tax"],
                severity=fm["sev"],
                cluster_algo="hdbscan_v1",
                embedding_model="all-MiniLM-L6-v2",
                prompt_version="mode_v1",
                model_version="llama3-8b"
            )
            db.add(fmode)
            
        db.flush()
        
        # Map tasks to Failure Mode Members (Baseline)
        tasks_mapping = {
          "tb-task-02": "fm1",
          "tb-task-04": "fm2",
          "tb-task-05": "fm3",
          "tb-task-06": "fm4",
          "tb-task-07": "fm5",
          "tb-task-09": "fm6"
        }
        
        for task_id, fm_id in tasks_mapping.items():
            fl_id = f"fl_run-tb2-baseline_{task_id}"
            member = FailureModeMember(
                failure_mode_id=fm_id,
                failure_label_id=fl_id,
                distance=0.0
            )
            db.add(member)
            
        # Map tasks to Failure Mode Members (Variant)
        variant_tasks = ["tb-task-05", "tb-task-07"]
        for task_id in variant_tasks:
            fl_id = f"fl_run-tb2-variant-1_{task_id}"
            member = FailureModeMember(
                failure_mode_id=tasks_mapping[task_id],
                failure_label_id=fl_id,
                distance=0.0
            )
            db.add(member)
            
        db.commit()
        
        # 3. Seed Eval Suites
        es1 = EvalSuite(
            id="es1",
            benchmark_slug="terminal-bench@2.0",
            name="Filesystem & Permission Regressions",
            description="Validates that the agent can execute commands safely without triggering sudo locks or writing in restricted directories.",
            source_type="failure_mode",
            source_metadata={"failure_mode_id": "fm5"},
            case_count=1,
            scoring_strategy="benchmark_native"
        )
        es2 = EvalSuite(
            id="es2",
            benchmark_slug="terminal-bench@2.0",
            name="Conflict Resolution & Git Files",
            description="Evaluates agent proficiency rebasing code branches and fixing merge conflicts.",
            source_type="failure_mode",
            source_metadata={"failure_mode_id": "fm1"},
            case_count=1,
            scoring_strategy="benchmark_native"
        )
        db.add(es1)
        db.add(es2)
        db.flush()
        
        # 4. Seed Eval Cases
        ec1 = EvalCase(
            id="ec1",
            eval_suite_id="es1",
            failure_label_id="fl_run-tb2-baseline_tb-task-07",
            run_id="run-tb2-baseline",
            run_task_id="run-tb2-baseline_tb-task-07",
            benchmark_task_id="tb-task-07",
            input_spec={"task_id": "tb-task-07", "slug": "restricted-sudo-write", "original_instructions": TASKS_DATA[6]["description"]},
            expected_spec={"assertions": [{"type": "exit_code", "expected": 0}]},
            scoring_strategy="benchmark_native",
            weight=1.0
        )
        ec2 = EvalCase(
            id="ec2",
            eval_suite_id="es2",
            failure_label_id="fl_run-tb2-baseline_tb-task-02",
            run_id="run-tb2-baseline",
            run_task_id="run-tb2-baseline_tb-task-02",
            benchmark_task_id="tb-task-02",
            input_spec={"task_id": "tb-task-02", "slug": "git-rebase-conflict", "original_instructions": TASKS_DATA[1]["description"]},
            expected_spec={"assertions": [{"type": "exit_code", "expected": 0}]},
            scoring_strategy="benchmark_native",
            weight=1.0
        )
        db.add(ec1)
        db.add(ec2)
        db.flush()
        
        # 5. Seed Eval Runs (Baseline runs have metrics: pass_rate = 0.0)
        er1 = EvalRun(
            id="er1",
            eval_suite_id="es1",
            experiment_variant_id=None,
            harness_version_id="v1.0.0",
            run_mode="online_rerun",
            status="completed",
            metrics={"pass_rate": 0.0, "total_cases": 1}
        )
        er2 = EvalRun(
            id="er2",
            eval_suite_id="es2",
            experiment_variant_id=None,
            harness_version_id="v1.0.0",
            run_mode="online_rerun",
            status="completed",
            metrics={"pass_rate": 0.0, "total_cases": 1}
        )
        db.add(er1)
        db.add(er2)
        db.flush()
        
        # 6. Seed Experiment
        exp = Experiment(
            id="exp1",
            benchmark_slug="terminal-bench@2.0",
            name="Improve CWD Working Directory",
            description="Experiment targeting CWD middleware or parameter checks to improve git and filesystem commands execution.",
            base_harness_version_id="v1.0.0",
            target_description="Improve CWD Working Directory",
            targets=[{"type": "failure_mode", "id": "fm1", "desired_delta": 0.2}],
            regression_policy={"guard_suites": [{"eval_suite_id": "es1", "max_allowed_drop": 0.0}], "global_min_success_rate": 0.5}
        )
        db.add(exp)
        db.flush()
        
        # 7. Seed Variant
        var = ExperimentVariant(
            id="ev1",
            experiment_id="exp1",
            variant_label="agent-with-cwd-middleware",
            harness_version_id="v1.0.0-var-1",
            status="pending",
            summary_metrics=None,
            created_at=datetime.utcnow()
        )
        db.add(var)
        db.flush()
        
        # 8. Seed Variant Eval Runs
        # Variant es1 (filesystem check) fails, so pass_rate = 0.0
        er_var_1 = EvalRun(
            id="er_var_1",
            eval_suite_id="es1",
            experiment_variant_id="ev1",
            harness_version_id="v1.0.0-var-1",
            run_mode="online_rerun",
            status="completed",
            metrics={"pass_rate": 0.0, "total_cases": 1}
        )
        # Variant es2 (git conflict resolve) passes, so pass_rate = 1.0
        er_var_2 = EvalRun(
            id="er_var_2",
            eval_suite_id="es2",
            experiment_variant_id="ev1",
            harness_version_id="v1.0.0-var-1",
            run_mode="online_rerun",
            status="completed",
            metrics={"pass_rate": 1.0, "total_cases": 1}
        )
        db.add(er_var_1)
        db.add(er_var_2)
        db.commit()
        
        # Now run compute promotion logic to get variant metrics updated
        from app.api.v1.experiments import compute_promotion
        result = compute_promotion("exp1", "ev1", db)
        print("Pre-computed promotion result:", json.dumps(result, indent=2))
        
        print("Database dev.db successfully seeded!")
    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
