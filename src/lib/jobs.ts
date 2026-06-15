import { db } from './db';
import { diagnoseFailure } from './llm';
import { clusterFailuresLocally } from './cluster';

interface Job {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  created_at: string;
  finished_at?: string;
  error?: string;
}

// In-memory jobs store attached to global context to survive HMR in dev
const globalJobs = (global as any).jobs || {};
(global as any).jobs = globalJobs;

export function createJob(prefix: string): string {
  const jobId = `${prefix}-job-${Math.floor(100000 + Math.random() * 900000)}`;
  
  let type = 'unknown';
  if (prefix === 'diag') type = 'diagnose_failures';
  else if (prefix === 'cluster') type = 'recluster_failure_modes';
  else if (prefix === 'propose') type = 'propose_variants';

  globalJobs[jobId] = {
    id: jobId,
    type,
    status: 'pending',
    progress: 0.0,
    created_at: new Date().toISOString()
  };
  return jobId;
}

export function getJob(jobId: string): Job | undefined {
  return globalJobs[jobId];
}

export function updateJob(jobId: string, status: Job['status'], progress: number, error?: string) {
  const job = globalJobs[jobId];
  if (job) {
    job.status = status;
    job.progress = Math.min(1.0, Math.max(0.0, progress));
    if (error) job.error = error;
    if (status === 'completed' || status === 'failed') {
      job.finished_at = new Date().toISOString();
    }
  }
}

// Background diagnosis worker
export async function runBackgroundDiagnosis(jobId: string, runId: string) {
  try {
    updateJob(jobId, 'running', 0.05);

    // Fetch run
    const run = db.prepare('SELECT id FROM runs WHERE id = ?').get(runId);
    if (!run) {
      updateJob(jobId, 'failed', 0.0, 'Run not found');
      return;
    }

    // Fetch all failed tasks for the run
    const failedTasks = db.prepare(`
      SELECT rt.id, rt.run_id, bt.task_id, bt.title as slug, bt.category, bt.difficulty,
             json_extract(bt.metadata, '$.description') as description
      FROM run_tasks rt
      JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
      WHERE rt.run_id = ? AND rt.status = 'FAIL'
    `).all(runId) as any[];

    if (failedTasks.length === 0) {
      updateJob(jobId, 'completed', 1.0);
      return;
    }

    for (let i = 0; i < failedTasks.length; i++) {
      const t = failedTasks[i];
      
      // Fetch trace steps
      const dbSteps = db.prepare(`
        SELECT id, run_task_id, step_index, step_type, content, metadata
        FROM trace_steps
        WHERE run_task_id = ?
        ORDER BY step_index ASC
      `).all(t.id) as any[];

      const cleanSteps = dbSteps.map(s => {
        let type = 'LOG';
        const st = (s.step_type || '').toUpperCase();
        if (st === 'ASSISTANT') type = 'agent';
        else if (st === 'USER') type = 'user';
        else if (st === 'SYSTEM') type = 'system';
        else if (st === 'TOOL_CALL' || st === 'COMMAND') type = 'tool_call';
        else if (st === 'TOOL_RESULT') type = 'tool_output';

        return {
          run_task_id: t.id,
          step_index: s.step_index,
          step_type: st,
          content: s.content,
          output: type === 'tool_output' ? s.content : null,
          type
        };
      });

      const diagnosis = await diagnoseFailure(t.description, t.slug, cleanSteps);

      // Map taxonomy label
      let mappedTaxonomy = 'OTHER';
      const incomingTaxonomy = (diagnosis.taxonomy_label || '').toUpperCase();
      if (['GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER'].includes(incomingTaxonomy)) {
        mappedTaxonomy = incomingTaxonomy;
      } else if (incomingTaxonomy === 'SAFETY_VIOLATION') {
        mappedTaxonomy = 'SAFETY';
      }

      // Upsert failure label
      db.prepare(`
        INSERT INTO failure_labels (run_task_id, is_failure, source, score, diagnosis_text, taxonomy_primary, taxonomy_secondary)
        VALUES (?, 1, 'LLM_JUDGE', NULL, ?, ?, '[]')
        ON CONFLICT(run_task_id) DO UPDATE SET
          diagnosis_text = excluded.diagnosis_text,
          taxonomy_primary = excluded.taxonomy_primary,
          source = 'LLM_JUDGE',
          updated_at = CURRENT_TIMESTAMP
      `).run(t.id, diagnosis.diagnosis_text, mappedTaxonomy);

      // Update progress incrementally
      const progress = 0.05 + (i + 1) / failedTasks.length * 0.90;
      updateJob(jobId, 'running', progress);
    }

    updateJob(jobId, 'completed', 1.0);
  } catch (err: any) {
    console.error('Background Diagnosis Error:', err);
    updateJob(jobId, 'failed', 0.0, err.message || 'Error occurred during failure diagnosis.');
  }
}

// Background reclustering worker
export async function runBackgroundReclustering(jobId: string, benchmarkId: number, runIds: string[]) {
  try {
    updateJob(jobId, 'running', 0.1);

    if (runIds.length === 0) {
      updateJob(jobId, 'completed', 1.0);
      return;
    }

    // Fetch all failed tasks with their failure labels for the target runs
    const placeholders = runIds.map(() => '?').join(',');
    const failedTasks = db.prepare(`
      SELECT rt.id, rt.run_id, bt.task_id, bt.title as slug, bt.category, bt.difficulty,
             json_extract(bt.metadata, '$.description') as description,
             fl.diagnosis_text, fl.taxonomy_primary as taxonomy_label, fl.id as label_id
      FROM run_tasks rt
      JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
      JOIN failure_labels fl ON rt.id = fl.run_task_id
      WHERE rt.run_id IN (${placeholders})
    `).all(...runIds) as any[];

    updateJob(jobId, 'running', 0.3);

    if (failedTasks.length === 0) {
      updateJob(jobId, 'completed', 1.0);
      return;
    }

    // Run transaction to re-cluster
    const reclusterTx = db.transaction(() => {
      // 1. Delete previous failure mode members and failure modes for this benchmark
      db.prepare(`
        DELETE FROM failure_mode_members 
        WHERE failure_mode_id IN (SELECT id FROM failure_modes WHERE benchmark_id = ?)
      `).run(benchmarkId);

      db.prepare('DELETE FROM failure_modes WHERE benchmark_id = ?').run(benchmarkId);

      // 2. Perform clustering
      const clusters = clusterFailuresLocally(failedTasks);

      // 3. Insert new FailureModes and FailureModeMembers
      for (const cluster of clusters) {
        const fmResult = db.prepare(`
          INSERT INTO failure_modes (benchmark_id, name, description, taxonomy_primary, stats)
          VALUES (?, ?, ?, ?, '{}')
        `).run(benchmarkId, cluster.title, cluster.description, cluster.taxonomy_label);
        const failureModeId = fmResult.lastInsertRowid;

        for (const memberId of cluster.memberIds) {
          const taskObj = failedTasks.find(f => f.id === memberId);
          if (taskObj) {
            db.prepare(`
              INSERT OR IGNORE INTO failure_mode_members (failure_mode_id, failure_label_id, distance)
              VALUES (?, ?, 0.0)
            `).run(failureModeId, taskObj.label_id);
          }
        }
      }
    });

    reclusterTx();
    updateJob(jobId, 'running', 0.9);
    updateJob(jobId, 'completed', 1.0);
  } catch (err: any) {
    console.error('Background Reclustering Error:', err);
    updateJob(jobId, 'failed', 0.0, err.message || 'Error occurred during reclustering.');
  }
}
