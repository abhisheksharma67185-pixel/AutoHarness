const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const localDbPath = path.resolve(__dirname, '../autoharness.db');
const devDbPath = path.resolve(__dirname, '../backend/dev.db');

const targets = [
  { id: '3d309a90-6287-41be-8d5e-2f21fa6b6b5a', score: 0.7, label: 'Harness Experiment Candidate 2 Run', version: 'v1.0.0-var-2', version_id: 3 },
  { id: 'd0d73c99-dac2-4524-92da-41966db6d135', score: 0.8, label: 'Harness Experiment Candidate 3 Run', version: 'v1.0.0-var-3', version_id: 4 },
  { id: 'a9c67884-e443-43ae-b18e-0b0743faa29f', score: 0.9, label: 'Harness Experiment Candidate 4 Run', version: 'v1.0.0-var-4', version_id: 5 },
  { id: '86d98d13-f02a-4db9-b518-b2b478783008', score: 1.0, label: 'Harness Experiment Candidate 5 Run', version: 'v1.0.0-var-5', version_id: 6 }
];

async function seedProgression() {
  console.log('=== SEEDING PROGRESSION RUNS ===\n');

  // 1. Update Local Autoharness DB
  if (fs.existsSync(localDbPath)) {
    console.log(`Processing ${localDbPath}...`);
    const dbLocal = new Database(localDbPath);
    try {
      dbLocal.transaction(() => {
        // Insert harness versions
        for (const t of targets) {
          const existingVersion = dbLocal.prepare('SELECT id FROM harness_versions WHERE name = ?').get(t.version);
          if (!existingVersion) {
            console.log(`   - Adding Local Harness Version: ${t.version}`);
            dbLocal.prepare('INSERT INTO harness_versions (id, name, config, notes) VALUES (?, ?, ?, ?)')
              .run(t.version_id, t.version, JSON.stringify({ agent_model: "SigmaAgent", temperature: 0.1 }), `Variant proposed fix ${t.version_id - 1}`);
          }
        }

        const sourceRun = dbLocal.prepare('SELECT * FROM runs WHERE id = ?').get('run-tb2-variant-1');
        if (!sourceRun) {
          throw new Error('Source run run-tb2-variant-1 not found in autoharness.db');
        }

        for (const t of targets) {
          const existingRun = dbLocal.prepare('SELECT id FROM runs WHERE id = ?').get(t.id);
          if (existingRun) {
            console.log(`   - Run ${t.id} already exists, skipping.`);
            continue;
          }

          console.log(`   - Duplicating to run: ${t.id} (${t.version})`);
          dbLocal.prepare(`
            INSERT INTO runs (id, benchmark_id, agent_name, harness_version_id, run_label, metrics, raw_artifact_uri, global_score, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(t.id, sourceRun.benchmark_id, sourceRun.agent_name, t.version_id, t.label, sourceRun.metrics, sourceRun.raw_artifact_uri, t.score, sourceRun.created_at);

          const sourceTasks = dbLocal.prepare('SELECT * FROM run_tasks WHERE run_id = ?').all('run-tb2-variant-1');
          for (const st of sourceTasks) {
            const resTask = dbLocal.prepare(`
              INSERT INTO run_tasks (run_id, benchmark_task_id, status, score, raw_result, started_at, finished_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(t.id, st.benchmark_task_id, st.status, st.score, st.raw_result, st.started_at, st.finished_at);
            const newTaskId = resTask.lastInsertRowid;

            const sourceSteps = dbLocal.prepare('SELECT * FROM trace_steps WHERE run_task_id = ?').all(st.id);
            for (const step of sourceSteps) {
              dbLocal.prepare(`
                INSERT INTO trace_steps (run_task_id, step_index, step_type, content, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(newTaskId, step.step_index, step.step_type, step.content, step.metadata, step.created_at);
            }

            const sourceLabel = dbLocal.prepare('SELECT * FROM failure_labels WHERE run_task_id = ?').get(st.id);
            if (sourceLabel) {
              const res = dbLocal.prepare(`
                INSERT INTO failure_labels (run_task_id, is_failure, source, score, diagnosis_text, taxonomy_primary, taxonomy_secondary, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(newTaskId, sourceLabel.is_failure, sourceLabel.source, sourceLabel.score, sourceLabel.diagnosis_text, sourceLabel.taxonomy_primary, sourceLabel.taxonomy_secondary, sourceLabel.created_at, sourceLabel.updated_at);
              
              const newLabelId = res.lastInsertRowid;

              const sourceMember = dbLocal.prepare('SELECT * FROM failure_mode_members WHERE failure_label_id = ?').get(sourceLabel.id);
              if (sourceMember) {
                dbLocal.prepare(`
                  INSERT INTO failure_mode_members (failure_mode_id, failure_label_id, distance)
                  VALUES (?, ?, ?)
                `).run(sourceMember.failure_mode_id, newLabelId, sourceMember.distance);
              }
            }
          }
        }
      })();
      console.log('✅ Local autoharness.db processed successfully.\n');
    } finally {
      dbLocal.close();
    }
  }

  // 2. Update Backend Dev DB
  if (fs.existsSync(devDbPath)) {
    console.log(`Processing ${devDbPath}...`);
    const dbDev = new Database(devDbPath);
    try {
      dbDev.transaction(() => {
        const sourceRun = dbDev.prepare('SELECT * FROM runs WHERE id = ?').get('run-tb2-variant-1');
        if (!sourceRun) {
          throw new Error('Source run run-tb2-variant-1 not found in dev.db');
        }

        for (const t of targets) {
          const existingRun = dbDev.prepare('SELECT id FROM runs WHERE id = ?').get(t.id);
          if (existingRun) {
            console.log(`   - Run ${t.id} already exists, skipping.`);
            continue;
          }

          console.log(`   - Duplicating to run: ${t.id} (${t.version})`);
          dbDev.prepare(`
            INSERT INTO runs (id, job_id, benchmark_slug, run_label, agent_name, harness_version, status, global_score, metrics, raw_artifact_uri, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(t.id, `job-${t.id}`, sourceRun.benchmark_slug, t.label, sourceRun.agent_name, t.version, sourceRun.status, t.score, sourceRun.metrics, sourceRun.raw_artifact_uri, sourceRun.created_at);

          const sourceTasks = dbDev.prepare('SELECT * FROM run_tasks WHERE run_id = ?').all('run-tb2-variant-1');
          for (const st of sourceTasks) {
            const newTaskId = `${t.id}_${st.benchmark_task_id}`;
            dbDev.prepare(`
              INSERT INTO run_tasks (id, run_id, benchmark_task_id, task_slug, category, difficulty, status, score, raw_task_json, started_at, finished_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(newTaskId, t.id, st.benchmark_task_id, st.task_slug, st.category, st.difficulty, st.status, st.score, st.raw_task_json, st.started_at, st.finished_at);

            const sourceSteps = dbDev.prepare('SELECT * FROM trace_steps WHERE run_task_id = ?').all(st.id);
            for (const step of sourceSteps) {
              dbDev.prepare(`
                INSERT INTO trace_steps (run_task_id, step_index, step_type, content, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(newTaskId, step.step_index, step.step_type, step.content, step.metadata, step.created_at);
            }

            const sourceLabel = dbDev.prepare('SELECT * FROM failure_labels WHERE run_task_id = ?').get(st.id);
            if (sourceLabel) {
              const newLabelId = `fl_${t.id}_${st.benchmark_task_id}`;
              dbDev.prepare(`
                INSERT INTO failure_labels (id, run_id, run_task_id, diagnosis_text, taxonomy_primary, severity, confidence, prompt_version, model_version, llm_latency_ms, raw_response, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(newLabelId, t.id, newTaskId, sourceLabel.diagnosis_text, sourceLabel.taxonomy_primary, sourceLabel.severity, sourceLabel.confidence, sourceLabel.prompt_version, sourceLabel.model_version, sourceLabel.llm_latency_ms, sourceLabel.raw_response, sourceLabel.created_at);

              const sourceMember = dbDev.prepare('SELECT * FROM failure_mode_members WHERE failure_label_id = ?').get(sourceLabel.id);
              if (sourceMember) {
                dbDev.prepare(`
                  INSERT INTO failure_mode_members (failure_mode_id, failure_label_id, distance)
                  VALUES (?, ?, ?)
                `).run(sourceMember.failure_mode_id, newLabelId, sourceMember.distance);
              }
            }
          }
        }
      })();
      console.log('✅ Backend dev.db processed successfully.\n');
    } finally {
      dbDev.close();
    }
  }

  console.log('🎉 Seeding complete! 🎉');
}

seedProgression().catch(console.error);
