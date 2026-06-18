import { db } from './db';
import { IngestionPayload } from './types';
import { diagnoseFailure } from './llm';
import { clusterFailuresLocally } from './cluster';
import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

export async function performIngestion(payload: IngestionPayload): Promise<{
  success: boolean;
  run_id: string;
  ingested_tasks: number;
}> {
  const { run_id, metadata, tasks } = payload;

  if (!run_id || !metadata || !tasks || !Array.isArray(tasks)) {
    throw new Error('Missing run_id, metadata, or tasks array in payload');
  }

  // Pre-fetch all async diagnoses outside the database transaction
  const diagnosesMap = new Map<string, { diagnosis_text: string; taxonomy_label: string }>();

  for (const t of tasks) {
    const isPass = t.success === true || t.score >= 1.0;
    if (!isPass) {
      const cleanSteps = (t.steps || []).map(s => {
        let stepType = 'LOG';
        const originalType = (s.type || '').toLowerCase();
        if (originalType === 'agent') stepType = 'ASSISTANT';
        else if (originalType === 'user') stepType = 'USER';
        else if (originalType === 'system') stepType = 'SYSTEM';
        else if (originalType === 'tool_call' || originalType === 'command') stepType = 'TOOL_CALL';
        else if (originalType === 'tool_output' || originalType === 'stdout' || originalType === 'stderr') stepType = 'TOOL_RESULT';

        return {
          run_task_id: 0,
          step_index: s.step_index,
          step_type: stepType,
          content: s.content || s.output || '',
          metadata: '{}'
        };
      });

      const diagnosis = await diagnoseFailure(t.description, t.slug, cleanSteps);
      
      let mappedTaxonomy = 'OTHER';
      const incomingTaxonomy = (diagnosis.taxonomy_label || '').toUpperCase();
      if (['GAP', 'AMBIGUITY', 'TOOL_MISUSE', 'CODE_BUG', 'UPSTREAM', 'SAFETY', 'OTHER'].includes(incomingTaxonomy)) {
        mappedTaxonomy = incomingTaxonomy;
      } else if (incomingTaxonomy === 'SAFETY_VIOLATION') {
        mappedTaxonomy = 'SAFETY';
      }

      diagnosesMap.set(t.task_id, {
        diagnosis_text: diagnosis.diagnosis_text,
        taxonomy_label: mappedTaxonomy
      });
    }
  }

  // Synchronous database transaction
  const runIngestionTransaction = db.transaction(async () => {
    // 1. Resolve or create benchmark record
    const benchSlug = metadata.benchmark_slug || 'terminal_bench_2';
    const benchName = metadata.benchmark || 'Terminal-Bench 2.0';
    const benchDesc = metadata.benchmark_description || 'Terminal operations benchmark for agent evaluation.';
    const benchUrl = metadata.benchmark_source_url || '';

    await db.prepare(`
      INSERT INTO benchmarks (name, slug, description, source_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (slug) DO NOTHING
    `).run(benchName, benchSlug, benchDesc, benchUrl);

    const benchmarkRow = await db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(benchSlug) as any;
    const benchmarkId = benchmarkRow.id;

    // 2. Resolve or create harness version
    const harnessName = metadata.harness_version || 'v1.0.0';
    const harnessConfig = JSON.stringify(metadata.harness_config || { agent_model: metadata.agent || 'SigmaAgent' });
    const harnessNotes = metadata.harness_notes || 'Auto-registered during ingestion';

    await db.prepare(`
      INSERT INTO harness_versions (name, config, notes)
      VALUES (?, ?, ?)
      ON CONFLICT (name) DO NOTHING
    `).run(harnessName, harnessConfig, harnessNotes);

    const harnessRow = await db.prepare('SELECT id FROM harness_versions WHERE name = ?').get(harnessName) as any;
    const harnessVersionId = harnessRow.id;

    // 3. Delete existing run to keep ingestion idempotent (clean cascading delete)
    await db.prepare('DELETE FROM runs WHERE id = ?').run(run_id);

    // 4. Insert runs baseline record
    await db.prepare(`
      INSERT INTO runs (id, benchmark_id, agent_name, harness_version_id, run_label, metrics, raw_artifact_uri, global_score)
      VALUES (?, ?, ?, ?, ?, '{}', ?, 0.0)
    `).run(
      run_id,
      benchmarkId,
      metadata.agent || 'SigmaAgent',
      harnessVersionId,
      metadata.run_label || `Run ${run_id}`,
      metadata.raw_artifact_uri || ''
    );

    let passedCount = 0;
    let failedCount = 0;
    let scoreSum = 0;
    const categoryScores: Record<string, { sum: number; count: number }> = {};
    const failedTasksForClustering: any[] = [];

    // 5. Ingest tasks and steps
    for (const t of tasks) {
      // Register task definition
      await db.prepare(`
        INSERT INTO benchmark_tasks (benchmark_id, task_id, title, category, difficulty, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (benchmark_id, task_id) DO NOTHING
      `).run(
        benchmarkId,
        t.task_id,
        t.slug,
        t.category,
        t.difficulty,
        JSON.stringify({ description: t.description })
      );

      const taskRow = await db.prepare('SELECT id FROM benchmark_tasks WHERE benchmark_id = ? AND task_id = ?').get(benchmarkId, t.task_id) as any;
      const benchmarkTaskId = taskRow.id;

      const isPass = t.success === true || t.score >= 1.0;
      const status = isPass ? 'PASS' : 'FAIL';

      if (isPass) passedCount++;
      else failedCount++;
      scoreSum += t.score;

      if (!categoryScores[t.category]) {
        categoryScores[t.category] = { sum: 0, count: 0 };
      }
      categoryScores[t.category].sum += t.score;
      categoryScores[t.category].count += 1;

      // Save execution details
      const runTaskResult = await db.prepare(`
        INSERT INTO run_tasks (run_id, benchmark_task_id, status, score, raw_result)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id
      `).run(run_id, benchmarkTaskId, status, t.score, JSON.stringify(t));
      const runTaskId = runTaskResult.lastInsertRowid;

      // Ingest steps
      if (t.steps && Array.isArray(t.steps)) {
        for (const s of t.steps) {
          let stepType = 'LOG';
          const originalType = (s.type || '').toLowerCase();
          if (originalType === 'agent') stepType = 'ASSISTANT';
          else if (originalType === 'user') stepType = 'USER';
          else if (originalType === 'system') stepType = 'SYSTEM';
          else if (originalType === 'tool_call' || originalType === 'command') stepType = 'TOOL_CALL';
          else if (originalType === 'tool_output' || originalType === 'stdout' || originalType === 'stderr') stepType = 'TOOL_RESULT';

          await db.prepare(`
            INSERT INTO trace_steps (run_task_id, step_index, step_type, content, metadata)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            runTaskId,
            s.step_index,
            stepType,
            s.content || s.output || '',
            JSON.stringify(s.metadata || {})
          );
        }
      }

      // 6. Ingest failure labels
      if (!isPass) {
        const preFetched = diagnosesMap.get(t.task_id) || {
          diagnosis_text: 'Agent failed to complete the task successfully.',
          taxonomy_label: 'OTHER'
        };

        const labelResult = await db.prepare(`
          INSERT INTO failure_labels (run_task_id, is_failure, source, score, diagnosis_text, taxonomy_primary, taxonomy_secondary)
          VALUES (?, 1, 'BENCHMARK', NULL, ?, ?, '[]')
          RETURNING id
        `).run(runTaskId, preFetched.diagnosis_text, preFetched.taxonomy_label);

        failedTasksForClustering.push({
          id: runTaskId,
          label_id: labelResult.lastInsertRowid,
          run_id,
          task_id: t.task_id,
          status,
          score: t.score,
          slug: t.slug,
          category: t.category,
          difficulty: t.difficulty,
          description: t.description,
          diagnosis_text: preFetched.diagnosis_text,
          taxonomy_label: preFetched.taxonomy_label
        });
      }
    }

    // 7. Re-cluster failed tasks and link FailureModes
    const clusters = clusterFailuresLocally(failedTasksForClustering);
    const taxonomyDistribution: Record<string, number> = {};

    for (const cluster of clusters) {
      // Create failure mode linked to benchmark
      const fmResult = await db.prepare(`
        INSERT INTO failure_modes (benchmark_id, name, description, taxonomy_primary, stats)
        VALUES (?, ?, ?, ?, '{}')
        RETURNING id
      `).run(benchmarkId, cluster.title, cluster.description, cluster.taxonomy_label);
      const failureModeId = fmResult.lastInsertRowid;

      // Associate failed tasks through failure labels
      for (const memberId of cluster.memberIds) {
        const taskObj = failedTasksForClustering.find(f => f.id === memberId);
        if (taskObj) {
          await db.prepare(`
            INSERT INTO failure_mode_members (failure_mode_id, failure_label_id, distance)
            VALUES (?, ?, 0.0)
            ON CONFLICT (failure_mode_id, failure_label_id) DO NOTHING
          `).run(failureModeId, taskObj.label_id);

          taxonomyDistribution[taskObj.taxonomy_label] = (taxonomyDistribution[taskObj.taxonomy_label] || 0) + 1;
        }
      }
    }

    // 8. Compute final metrics
    const totalTasks = tasks.length;
    const passRate = totalTasks > 0 ? passedCount / totalTasks : 0;
    const avgScore = totalTasks > 0 ? scoreSum / totalTasks : 0;

    const categoryAverages: Record<string, number> = {};
    for (const [cat, data] of Object.entries(categoryScores)) {
      categoryAverages[cat] = data.count > 0 ? data.sum / data.count : 0;
    }

    const metricsObj = {
      total_tasks: totalTasks,
      passed_tasks: passedCount,
      failed_tasks: failedCount,
      pass_rate: passRate,
      avg_score: avgScore,
      category_scores: categoryAverages,
      taxonomy_distribution: taxonomyDistribution
    };

    // Save overall score to runs
    await db.prepare(`
      UPDATE runs 
      SET global_score = ?, metrics = ? 
      WHERE id = ?
    `).run(passRate, JSON.stringify(metricsObj), run_id);
  });

  await runIngestionTransaction();

  // Replicate to backend/dev.db to avoid database divergence
  const devDbPath = path.join(process.cwd(), 'backend', 'dev.db');
  let devDb: Database.Database | null = null;
  try {
    devDb = new Database(devDbPath, { timeout: 5000 });
    devDb.pragma('foreign_keys = ON');

    const runDevIngestion = devDb.transaction(() => {
      // 1. Delete existing run
      devDb!.prepare('DELETE FROM runs WHERE id = ?').run(run_id);

      // 2. Insert runs baseline record
      const benchSlug = metadata.benchmark_slug || 'terminal_bench_2';
      const agentName = metadata.agent || 'SigmaAgent';
      const harnessName = metadata.harness_version || 'v1.0.0';
      const label = metadata.run_label || `Run ${run_id}`;
      const rawArtifactUri = metadata.raw_artifact_uri || '';
      const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

      devDb!.prepare(`
        INSERT INTO runs (id, job_id, benchmark_slug, run_label, agent_name, harness_version, status, global_score, metrics, raw_artifact_uri, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'completed', 0.0, '{}', ?, ?)
      `).run(run_id, run_id, benchSlug, label, agentName, harnessName, rawArtifactUri, nowStr);

      let passedCount = 0;
      let failedCount = 0;
      let scoreSum = 0;
      const categoryScores: Record<string, { sum: number; count: number }> = {};
      const failedTasksForClustering: any[] = [];

      // 3. Loop over tasks and insert tasks, steps, failure labels
      for (const t of tasks) {
        const isPass = t.success === true || t.score >= 1.0;
        const status = isPass ? 'PASS' : 'FAIL';

        if (isPass) passedCount++;
        else failedCount++;
        scoreSum += t.score;

        if (!categoryScores[t.category]) {
          categoryScores[t.category] = { sum: 0, count: 0 };
        }
        categoryScores[t.category].sum += t.score;
        categoryScores[t.category].count += 1;

        const devRunTaskId = crypto.randomUUID();

        // Ingest task
        devDb!.prepare(`
          INSERT INTO run_tasks (id, run_id, benchmark_task_id, task_slug, category, difficulty, status, score, raw_task_json, started_at, finished_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          devRunTaskId,
          run_id,
          t.task_id,
          t.slug,
          t.category,
          t.difficulty,
          status,
          t.score,
          JSON.stringify(t),
          nowStr,
          nowStr
        );

        // Ingest steps
        if (t.steps && Array.isArray(t.steps)) {
          for (const s of t.steps) {
            let stepType = 'LOG';
            const originalType = (s.type || '').toLowerCase();
            if (originalType === 'agent') stepType = 'ASSISTANT';
            else if (originalType === 'user') stepType = 'USER';
            else if (originalType === 'system') stepType = 'SYSTEM';
            else if (originalType === 'tool_call' || originalType === 'command') stepType = 'TOOL_CALL';
            else if (originalType === 'tool_output' || originalType === 'stdout' || originalType === 'stderr') stepType = 'TOOL_RESULT';

            devDb!.prepare(`
              INSERT INTO trace_steps (run_task_id, step_index, step_type, content, metadata)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              devRunTaskId,
              s.step_index,
              stepType,
              s.content || s.output || '',
              JSON.stringify(s.metadata || {})
            );
          }
        }

        // Ingest failure labels
        if (!isPass) {
          const preFetched = diagnosesMap.get(t.task_id) || {
            diagnosis_text: 'Agent failed to complete the task successfully.',
            taxonomy_label: 'OTHER'
          };

          const devFailureLabelId = crypto.randomUUID();
          devDb!.prepare(`
            INSERT INTO failure_labels (id, run_id, run_task_id, diagnosis_text, taxonomy_primary, severity, confidence, prompt_version, model_version, llm_latency_ms, raw_response, created_at)
            VALUES (?, ?, ?, ?, ?, 'medium', 'high', 'diag_v1', 'unknown', 0, '{}', ?)
          `).run(
            devFailureLabelId,
            run_id,
            devRunTaskId,
            preFetched.diagnosis_text,
            preFetched.taxonomy_label.toLowerCase(),
            nowStr
          );

          failedTasksForClustering.push({
            id: devRunTaskId,
            label_id: devFailureLabelId,
            run_id,
            task_id: t.task_id,
            status,
            score: t.score,
            slug: t.slug,
            category: t.category,
            difficulty: t.difficulty,
            description: t.description,
            diagnosis_text: preFetched.diagnosis_text,
            taxonomy_label: preFetched.taxonomy_label
          });
        }
      }

      // 4. Re-cluster failed tasks and link FailureModes in devDb
      const clusters = clusterFailuresLocally(failedTasksForClustering);
      const taxonomyDistribution: Record<string, number> = {};

      for (const cluster of clusters) {
        const devFailureModeId = crypto.randomUUID();
        devDb!.prepare(`
          INSERT INTO failure_modes (id, benchmark_slug, name, description, taxonomy_primary, severity, cluster_algo, embedding_model, prompt_version, model_version, created_at)
          VALUES (?, ?, ?, ?, ?, 'medium', 'local_cluster', 'none', 'mode_v1', 'unknown', ?)
        `).run(
          devFailureModeId,
          benchSlug,
          cluster.title,
          cluster.description,
          cluster.taxonomy_label.toLowerCase(),
          nowStr
        );

        for (const memberId of cluster.memberIds) {
          const taskObj = failedTasksForClustering.find(f => f.id === memberId);
          if (taskObj) {
            devDb!.prepare(`
              INSERT OR IGNORE INTO failure_mode_members (failure_mode_id, failure_label_id, distance)
              VALUES (?, ?, 0.0)
            `).run(devFailureModeId, taskObj.label_id);

            taxonomyDistribution[taskObj.taxonomy_label] = (taxonomyDistribution[taskObj.taxonomy_label] || 0) + 1;
          }
        }
      }

      // 5. Compute final metrics
      const totalTasks = tasks.length;
      const passRate = totalTasks > 0 ? passedCount / totalTasks : 0;
      const avgScore = totalTasks > 0 ? scoreSum / totalTasks : 0;

      const categoryAverages: Record<string, number> = {};
      for (const [cat, data] of Object.entries(categoryScores)) {
        categoryAverages[cat] = data.count > 0 ? data.sum / data.count : 0;
      }

      const metricsObj = {
        total_tasks: totalTasks,
        passed_tasks: passedCount,
        failed_tasks: failedCount,
        pass_rate: passRate,
        avg_score: avgScore,
        category_scores: categoryAverages,
        taxonomy_distribution: taxonomyDistribution
      };

      // Save overall score to runs
      devDb!.prepare(`
        UPDATE runs 
        SET global_score = ?, metrics = ? 
        WHERE id = ?
      `).run(passRate, JSON.stringify(metricsObj), run_id);
    });

    runDevIngestion();
  } catch (err: any) {
    console.error('Failed to replicate ingestion to backend dev.db database:', err);
  } finally {
    try {
      if (devDb) devDb.close();
    } catch {}
  }

  return { success: true, run_id, ingested_tasks: tasks.length };
}

export async function syncRunDevToLocal(runId: string): Promise<boolean> {
  const devDbPath = path.join(process.cwd(), 'backend', 'dev.db');
  let devDb: Database.Database | null = null;
  try {
    devDb = new Database(devDbPath, { timeout: 5000 });
  } catch (err) {
    console.error('Failed to open dev.db for sync:', err);
    return false;
  }

  try {
    const runDev = devDb.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any;
    if (!runDev) {
      return false;
    }

    // Check if already in autoharness.db
    const existing = await db.prepare('SELECT id FROM runs WHERE id = ?').get(runId);
    if (existing) {
      return true;
    }

    // Perform sync within transaction
    const syncTx = db.transaction(async () => {
      // Resolve benchmark
      let benchmarkId = 0;
      const benchRow = await db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(runDev.benchmark_slug) as any;
      if (benchRow) {
        benchmarkId = benchRow.id;
      } else {
        const insertBench = await db.prepare(`
          INSERT INTO benchmarks (name, slug, description, source_url)
          VALUES (?, ?, ?, ?)
          RETURNING id
        `).run(
          runDev.benchmark_slug === 'terminal-bench@2.0' ? 'Terminal-Bench 2.0' : runDev.benchmark_slug,
          runDev.benchmark_slug,
          'Auto-registered benchmark during dev.db sync',
          ''
        );
        benchmarkId = Number(insertBench.lastInsertRowid);
      }

      // Resolve harness version
      let harnessVersionId = 0;
      const hvRow = await db.prepare('SELECT id FROM harness_versions WHERE name = ?').get(runDev.harness_version) as any;
      if (hvRow) {
        harnessVersionId = hvRow.id;
      } else {
        const insertHv = await db.prepare(`
          INSERT INTO harness_versions (name, config, notes)
          VALUES (?, ?, ?)
          RETURNING id
        `).run(
          runDev.harness_version || 'unknown',
          JSON.stringify({}),
          'Auto-registered harness version during dev.db sync'
        );
        harnessVersionId = Number(insertHv.lastInsertRowid);
      }

      // Insert run
      await db.prepare(`
        INSERT INTO runs (id, benchmark_id, agent_name, harness_version_id, run_label, metrics, raw_artifact_uri, global_score, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runDev.id,
        benchmarkId,
        runDev.agent_name,
        harnessVersionId,
        runDev.run_label,
        typeof runDev.metrics === 'string' ? runDev.metrics : JSON.stringify(runDev.metrics || {}),
        runDev.raw_artifact_uri,
        runDev.global_score || 0.0,
        runDev.created_at || new Date().toISOString()
      );

      // Fetch tasks from devDb
      const tasksDev = devDb!.prepare('SELECT * FROM run_tasks WHERE run_id = ?').all(runId) as any[];

      for (const tDev of tasksDev) {
        // Insert benchmark task
        await db.prepare(`
          INSERT INTO benchmark_tasks (benchmark_id, task_id, title, category, difficulty, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (benchmark_id, task_id) DO NOTHING
        `).run(
          benchmarkId,
          tDev.benchmark_task_id,
          tDev.task_slug,
          tDev.category || 'unknown',
          tDev.difficulty || 'medium',
          JSON.stringify({ description: tDev.raw_task_json ? JSON.parse(tDev.raw_task_json).description || '' : '' })
        );

        const btRow = await db.prepare('SELECT id FROM benchmark_tasks WHERE benchmark_id = ? AND task_id = ?').get(benchmarkId, tDev.benchmark_task_id) as any;
        const benchmarkTaskId = btRow.id;

        // Insert run task
        const insertRt = await db.prepare(`
          INSERT INTO run_tasks (run_id, benchmark_task_id, status, score, raw_result, started_at, finished_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING id
        `).run(
          runId,
          benchmarkTaskId,
          tDev.status,
          tDev.score || 0.0,
          tDev.raw_task_json || '{}',
          tDev.started_at,
          tDev.finished_at
        );
        const localRunTaskId = insertRt.lastInsertRowid;

        // Fetch steps
        const stepsDev = devDb!.prepare('SELECT * FROM trace_steps WHERE run_task_id = ?').all(tDev.id) as any[];
        for (const sDev of stepsDev) {
          await db.prepare(`
            INSERT INTO trace_steps (run_task_id, step_index, step_type, content, metadata)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            localRunTaskId,
            sDev.step_index,
            sDev.step_type,
            sDev.content || '',
            sDev.metadata || '{}'
          );
        }

        // Fetch failure label
        const flDev = devDb!.prepare('SELECT * FROM failure_labels WHERE run_task_id = ?').get(tDev.id) as any;
        if (flDev) {
          await db.prepare(`
            INSERT INTO failure_labels (run_task_id, is_failure, source, score, diagnosis_text, taxonomy_primary, taxonomy_secondary)
            VALUES (?, 1, 'BENCHMARK', NULL, ?, ?, '[]')
          `).run(
            localRunTaskId,
            flDev.diagnosis_text,
            (flDev.taxonomy_primary || 'OTHER').toUpperCase()
          );
        }
      }
    });

    await syncTx();
    return true;
  } catch (err) {
    console.error('Error syncing run from dev.db to autoharness.db:', err);
    return false;
  } finally {
    try {
      devDb.close();
    } catch {}
  }
}

export function stringToIntegerId(str: string | number | undefined | null): number {
  if (str === undefined || str === null) return 0;
  if (typeof str === 'number') return str;
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }
  
  // Strip common prefixes
  const prefixMatch = str.match(/^(exp|ev|er|es|ec|fl|rt|run|eres|eresult)-?(.*)$/i);
  let content = str;
  if (prefixMatch) {
    content = prefixMatch[2];
  }
  if (/^\d+$/.test(content)) {
    return parseInt(content, 10);
  }

  // Consistent hashing FNV-1a style
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 1000000000; // 9-digit safe positive integer
}

function mapVariantStatus(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'pending') return 'PLANNED';
  if (s === 'evaluating') return 'RUNNING';
  if (s === 'promoted') return 'PROMOTED';
  if (s === 'rejected') return 'REJECTED';
  if (s === 'evaluated') return 'EVALUATED';
  return 'PLANNED';
}

export async function syncExperimentsDevToLocal(experimentId?: string): Promise<boolean> {
  // Sync dependencies first to ensure referenced runs/suites exist locally
  try {
    await syncEvalSuitesDevToLocal();
    await syncEvalRunsDevToLocal();
  } catch (depErr) {
    console.error('Failed to sync dependencies for experiments sync:', depErr);
  }

  const devDbPath = path.join(process.cwd(), 'backend', 'dev.db');
  let devDb: Database.Database | null = null;
  try {
    devDb = new Database(devDbPath, { timeout: 5000 });
  } catch (err) {
    console.error('Failed to open dev.db for experiments sync:', err);
    return false;
  }

  try {
    let query = 'SELECT * FROM experiments';
    const params: any[] = [];
    if (experimentId) {
      query += ' WHERE id = ?';
      params.push(experimentId);
    }
    const experimentsDev = devDb.prepare(query).all(...params) as any[];

    if (experimentsDev.length === 0) {
      return true;
    }

    const syncTx = db.transaction(async () => {
      for (const expDev of experimentsDev) {
        const localExpId = stringToIntegerId(expDev.id);

        // Resolve benchmark
        let benchmarkId = 0;
        const benchRow = await db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(expDev.benchmark_slug) as any;
        if (benchRow) {
          benchmarkId = benchRow.id;
        } else {
          const insertBench = await db.prepare(`
            INSERT INTO benchmarks (name, slug, description, source_url)
            VALUES (?, ?, ?, ?)
          `).run(
            expDev.benchmark_slug === 'terminal-bench@2.0' ? 'Terminal-Bench 2.0' : expDev.benchmark_slug,
            expDev.benchmark_slug,
            'Auto-registered benchmark during dev.db sync',
            ''
          );
          benchmarkId = Number(insertBench.lastInsertRowid);
        }

        // Resolve base harness version
        let baseHarnessVersionId = 0;
        const hvRow = await db.prepare('SELECT id FROM harness_versions WHERE name = ?').get(expDev.base_harness_version_id) as any;
        if (hvRow) {
          baseHarnessVersionId = hvRow.id;
        } else {
          const insertHv = await db.prepare(`
            INSERT INTO harness_versions (name, config, notes)
            VALUES (?, ?, ?)
          `).run(
            expDev.base_harness_version_id || 'v1.0.0',
            JSON.stringify({}),
            'Auto-registered base harness version during dev.db sync'
          );
          baseHarnessVersionId = Number(insertHv.lastInsertRowid);
        }

        // Ensure dummy/fallback eval_suite and eval_run exist to satisfy foreign key constraints
        await db.prepare(`
          INSERT INTO eval_suites (id, name, benchmark_id, description)
          VALUES (999999, 'Fallback Suite', ?, 'Fallback Suite for unresolved references')
          ON CONFLICT (id) DO NOTHING
        `).run(benchmarkId);

        await db.prepare(`
          INSERT INTO eval_runs (id, eval_suite_id, harness_version_id, status, metrics)
          VALUES (999999, 999999, ?, 'COMPLETED', '{}')
          ON CONFLICT (id) DO NOTHING
        `).run(baseHarnessVersionId);

        // Insert or replace experiment
        await db.prepare(`
          INSERT INTO experiments (id, name, benchmark_id, base_harness_version_id, target_description, config_template, regression_policy, created_at)
          VALUES (?, ?, ?, ?, ?, '{}', ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            benchmark_id = EXCLUDED.benchmark_id,
            base_harness_version_id = EXCLUDED.base_harness_version_id,
            target_description = EXCLUDED.target_description,
            config_template = EXCLUDED.config_template,
            regression_policy = EXCLUDED.regression_policy,
            created_at = EXCLUDED.created_at
        `).run(
          localExpId,
          expDev.name,
          benchmarkId,
          baseHarnessVersionId,
          expDev.target_description || '',
          typeof expDev.regression_policy === 'string' ? expDev.regression_policy : JSON.stringify(expDev.regression_policy || {}),
          expDev.created_at || new Date().toISOString()
        );

        // Sync targets
        await db.prepare('DELETE FROM experiment_targets WHERE experiment_id = ?').run(localExpId);
        let targetsArr: any[] = [];
        if (expDev.targets) {
          try {
            targetsArr = typeof expDev.targets === 'string' ? JSON.parse(expDev.targets) : expDev.targets;
          } catch {}
        }
        if (Array.isArray(targetsArr)) {
          for (const t of targetsArr) {
            const typeStr = (t.type || t.target_type || '').toUpperCase();
            const targetIdInt = stringToIntegerId(t.id || t.target_id);
            await db.prepare(`
              INSERT INTO experiment_targets (experiment_id, target_type, target_id, desired_delta)
              VALUES (?, ?, ?, ?)
            `).run(localExpId, typeStr, targetIdInt, t.desired_delta || 0.0);
          }
        }

        // Sync variants
        const variantsDev = devDb!.prepare('SELECT * FROM experiment_variants WHERE experiment_id = ?').all(expDev.id) as any[];
        await db.prepare('DELETE FROM experiment_variants WHERE experiment_id = ?').run(localExpId);
        
        for (const vDev of variantsDev) {
          const localVarId = stringToIntegerId(vDev.id);

          // Resolve harness version id for variant
          let variantHarnessVersionId = 0;
          const varHvRow = await db.prepare('SELECT id FROM harness_versions WHERE name = ?').get(vDev.harness_version_id) as any;
          if (varHvRow) {
            variantHarnessVersionId = varHvRow.id;
          } else {
            const insertVarHv = await db.prepare(`
              INSERT INTO harness_versions (name, config, notes)
              VALUES (?, ?, ?)
              RETURNING id
            `).run(
              vDev.harness_version_id,
              JSON.stringify({}),
              `Auto-registered harness variant version for ${vDev.variant_label}`
            );
            variantHarnessVersionId = Number(insertVarHv.lastInsertRowid);
          }

          await db.prepare(`
            INSERT INTO experiment_variants (id, experiment_id, harness_version_id, variant_label, config_diff, exported_config_uri, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
              experiment_id = EXCLUDED.experiment_id,
              harness_version_id = EXCLUDED.harness_version_id,
              variant_label = EXCLUDED.variant_label,
              config_diff = EXCLUDED.config_diff,
              exported_config_uri = EXCLUDED.exported_config_uri,
              status = EXCLUDED.status
          `).run(
            localVarId,
            localExpId,
            variantHarnessVersionId,
            vDev.variant_label,
            vDev.config_diff || '{}',
            vDev.exported_config_uri || '',
            mapVariantStatus(vDev.status)
          );

          // Sync variant eval summaries (if summary_metrics exists)
          let metricsObj: any = {};
          if (vDev.summary_metrics) {
            try {
              metricsObj = typeof vDev.summary_metrics === 'string' ? JSON.parse(vDev.summary_metrics) : vDev.summary_metrics;
            } catch {}
          }

          await db.prepare('DELETE FROM experiment_variant_eval_summaries WHERE experiment_variant_id = ?').run(localVarId);

          const targetMetrics = metricsObj.targets || [];
          const guardMetrics = metricsObj.guards || [];

          // Target summaries
          for (const tm of targetMetrics) {
            const suiteIdInt = stringToIntegerId(tm.suite_id);
            
            let baselineEvalRunIdInt = 999999;
            let variantEvalRunIdInt = 999999;

            try {
              const baseRunRow = devDb!.prepare(`
                SELECT id FROM eval_runs
                WHERE eval_suite_id = ? AND harness_version_id = ? AND experiment_variant_id IS NULL
                ORDER BY created_at DESC LIMIT 1
              `).get(tm.suite_id, expDev.base_harness_version_id) as any;
              if (baseRunRow) {
                baselineEvalRunIdInt = stringToIntegerId(baseRunRow.id);
              }
            } catch {}

            try {
              const varRunRow = devDb!.prepare(`
                SELECT id FROM eval_runs
                WHERE eval_suite_id = ? AND harness_version_id = ? AND experiment_variant_id = ?
                ORDER BY created_at DESC LIMIT 1
              `).get(tm.suite_id, vDev.harness_version_id, vDev.id) as any;
              if (varRunRow) {
                variantEvalRunIdInt = stringToIntegerId(varRunRow.id);
              }
            } catch {}

            await db.prepare(`
              INSERT INTO experiment_variant_eval_summaries (experiment_variant_id, eval_suite_id, baseline_eval_run_id, variant_eval_run_id, delta_pass_rate, regression_flag)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              localVarId,
              suiteIdInt,
              baselineEvalRunIdInt,
              variantEvalRunIdInt,
              tm.delta || 0.0,
              (tm.delta < tm.desired_delta) ? 1 : 0
            );
          }

          // Guard summaries
          for (const gm of guardMetrics) {
            const suiteIdInt = stringToIntegerId(gm.suite_id);
            
            let baselineEvalRunIdInt = 999999;
            let variantEvalRunIdInt = 999999;

            try {
              const baseRunRow = devDb!.prepare(`
                SELECT id FROM eval_runs
                WHERE eval_suite_id = ? AND harness_version_id = ? AND experiment_variant_id IS NULL
                ORDER BY created_at DESC LIMIT 1
              `).get(gm.suite_id, expDev.base_harness_version_id) as any;
              if (baseRunRow) {
                baselineEvalRunIdInt = stringToIntegerId(baseRunRow.id);
              }
            } catch {}

            try {
              const varRunRow = devDb!.prepare(`
                SELECT id FROM eval_runs
                WHERE eval_suite_id = ? AND harness_version_id = ? AND experiment_variant_id = ?
                ORDER BY created_at DESC LIMIT 1
              `).get(gm.suite_id, vDev.harness_version_id, vDev.id) as any;
              if (varRunRow) {
                variantEvalRunIdInt = stringToIntegerId(varRunRow.id);
              }
            } catch {}

            await db.prepare(`
              INSERT INTO experiment_variant_eval_summaries (experiment_variant_id, eval_suite_id, baseline_eval_run_id, variant_eval_run_id, delta_pass_rate, regression_flag)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              localVarId,
              suiteIdInt,
              baselineEvalRunIdInt,
              variantEvalRunIdInt,
              gm.delta || 0.0,
              (gm.delta < -gm.max_allowed_drop) ? 1 : 0
            );
          }
        }
      }
    });

    await syncTx();
    return true;
  } catch (err) {
    console.error('Error syncing experiments from dev.db to autoharness.db:', err);
    return false;
  } finally {
    try {
      if (devDb) devDb.close();
    } catch {}
  }
}

export async function syncEvalSuitesDevToLocal(evalSuiteId?: string): Promise<boolean> {
  const devDbPath = path.join(process.cwd(), 'backend', 'dev.db');
  let devDb: Database.Database | null = null;
  try {
    devDb = new Database(devDbPath, { timeout: 5000 });
  } catch (err) {
    console.error('Failed to open dev.db for eval suites sync:', err);
    return false;
  }

  try {
    let query = 'SELECT * FROM eval_suites';
    const params: any[] = [];
    if (evalSuiteId) {
      query += ' WHERE id = ?';
      params.push(evalSuiteId);
    }
    const suitesDev = devDb.prepare(query).all(...params) as any[];

    if (suitesDev.length === 0) {
      return true;
    }

    const syncTx = db.transaction(async () => {
      for (const sDev of suitesDev) {
        const localSuiteId = stringToIntegerId(sDev.id);

        // Resolve benchmark
        let benchmarkId = 0;
        const benchRow = await db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(sDev.benchmark_slug) as any;
        if (benchRow) {
          benchmarkId = benchRow.id;
        } else {
          const insertBench = await db.prepare(`
            INSERT INTO benchmarks (name, slug, description, source_url)
            VALUES (?, ?, ?, ?)
            RETURNING id
          `).run(
            sDev.benchmark_slug === 'terminal-bench@2.0' ? 'Terminal-Bench 2.0' : sDev.benchmark_slug,
            sDev.benchmark_slug,
            'Auto-registered benchmark during dev.db sync',
            ''
          );
          benchmarkId = Number(insertBench.lastInsertRowid);
        }

        // Insert or replace eval suite
        await db.prepare(`
          INSERT INTO eval_suites (id, name, benchmark_id, description, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            benchmark_id = EXCLUDED.benchmark_id,
            description = EXCLUDED.description,
            created_at = EXCLUDED.created_at
        `).run(
          localSuiteId,
          sDev.name,
          benchmarkId,
          sDev.description || '',
          sDev.created_at || new Date().toISOString()
        );

        // Fetch eval cases for this suite from devDb
        const casesDev = devDb!.prepare('SELECT * FROM eval_cases WHERE eval_suite_id = ?').all(sDev.id) as any[];
        
        await db.prepare('DELETE FROM eval_suite_members WHERE eval_suite_id = ?').run(localSuiteId);

        for (const cDev of casesDev) {
          const localCaseId = stringToIntegerId(cDev.id);

          // Resolve benchmark task id locally using the benchmark_task_id string slug
          let localBtId: number | null = null;
          const btRow = await db.prepare('SELECT id FROM benchmark_tasks WHERE benchmark_id = ? AND task_id = ?').get(benchmarkId, cDev.benchmark_task_id) as any;
          if (btRow) {
            localBtId = btRow.id;
          } else {
            await db.prepare(`
              INSERT INTO benchmark_tasks (benchmark_id, task_id, title, category, difficulty, metadata)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (benchmark_id, task_id) DO NOTHING
            `).run(
              benchmarkId,
              cDev.benchmark_task_id,
              cDev.benchmark_task_id,
              cDev.input_spec ? (typeof cDev.input_spec === 'string' ? JSON.parse(cDev.input_spec).category : cDev.input_spec.category) || 'unknown' : 'unknown',
              'medium',
              JSON.stringify({ description: cDev.input_spec ? (typeof cDev.input_spec === 'string' ? JSON.parse(cDev.input_spec).original_instructions : cDev.input_spec.original_instructions) || '' : '' })
            );
            const getBt = await db.prepare('SELECT id FROM benchmark_tasks WHERE benchmark_id = ? AND task_id = ?').get(benchmarkId, cDev.benchmark_task_id) as any;
            if (getBt) localBtId = getBt.id;
          }

          // Resolve failure label id - check if it exists locally first to prevent FK constraint failure
          let localFlId: number | null = null;
          if (cDev.failure_label_id) {
            const potentialFlId = stringToIntegerId(cDev.failure_label_id);
            const exists = await db.prepare('SELECT id FROM failure_labels WHERE id = ?').get(potentialFlId);
            if (exists) {
              localFlId = potentialFlId;
            }
          }

          // Insert or replace eval case
          await db.prepare(`
            INSERT INTO eval_cases (id, benchmark_task_id, failure_label_id, input_spec, expected_spec, scoring_config, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, '{}', 'MANUAL', ?)
            ON CONFLICT (id) DO UPDATE SET
              benchmark_task_id = EXCLUDED.benchmark_task_id,
              failure_label_id = EXCLUDED.failure_label_id,
              input_spec = EXCLUDED.input_spec,
              expected_spec = EXCLUDED.expected_spec,
              scoring_config = EXCLUDED.scoring_config,
              created_by = EXCLUDED.created_by,
              created_at = EXCLUDED.created_at
          `).run(
            localCaseId,
            localBtId,
            localFlId,
            typeof cDev.input_spec === 'string' ? cDev.input_spec : JSON.stringify(cDev.input_spec || {}),
            typeof cDev.expected_spec === 'string' ? cDev.expected_spec : JSON.stringify(cDev.expected_spec || {}),
            cDev.created_at || new Date().toISOString()
          );

          // Link in eval_suite_members
          await db.prepare(`
            INSERT INTO eval_suite_members (eval_suite_id, eval_case_id)
            VALUES (?, ?)
            ON CONFLICT (eval_suite_id, eval_case_id) DO NOTHING
          `).run(localSuiteId, localCaseId);
        }
      }
    });

    await syncTx();
    return true;
  } catch (err) {
    console.error('Error syncing eval suites from dev.db to autoharness.db:', err);
    return false;
  } finally {
    try {
      if (devDb) devDb.close();
    } catch {}
  }
}

export async function syncEvalRunsDevToLocal(evalRunId?: string): Promise<boolean> {
  const devDbPath = path.join(process.cwd(), 'backend', 'dev.db');
  let devDb: Database.Database | null = null;
  try {
    devDb = new Database(devDbPath, { timeout: 5000 });
  } catch (err) {
    console.error('Failed to open dev.db for eval runs sync:', err);
    return false;
  }

  try {
    let query = 'SELECT * FROM eval_runs';
    const params: any[] = [];
    if (evalRunId) {
      query += ' WHERE id = ?';
      params.push(evalRunId);
    }
    const runsDev = devDb.prepare(query).all(...params) as any[];

    if (runsDev.length === 0) {
      return true;
    }

    const syncTx = db.transaction(async () => {
      for (const rDev of runsDev) {
        const localRunId = stringToIntegerId(rDev.id);
        const localSuiteId = stringToIntegerId(rDev.eval_suite_id);

        const existsSuite = await db.prepare('SELECT id FROM eval_suites WHERE id = ?').get(localSuiteId);
        if (!existsSuite) {
          continue; // Skip if suite doesn't exist locally to prevent FK failure
        }

        // Resolve harness version name from dev database
        let localHvId = 0;
        const hvRow = await db.prepare('SELECT id FROM harness_versions WHERE name = ?').get(rDev.harness_version_id) as any;
        if (hvRow) {
          localHvId = hvRow.id;
        } else {
          const insertHv = await db.prepare(`
            INSERT INTO harness_versions (name, config, notes)
            VALUES (?, ?, ?)
            RETURNING id
          `).run(
            rDev.harness_version_id || 'unknown',
            JSON.stringify({}),
            'Auto-registered during eval run sync'
          );
          localHvId = Number(insertHv.lastInsertRowid);
        }

        // Insert or replace eval run
        await db.prepare(`
          INSERT INTO eval_runs (id, eval_suite_id, harness_version_id, run_id, status, metrics, created_at, finished_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            eval_suite_id = EXCLUDED.eval_suite_id,
            harness_version_id = EXCLUDED.harness_version_id,
            run_id = EXCLUDED.run_id,
            status = EXCLUDED.status,
            metrics = EXCLUDED.metrics,
            created_at = EXCLUDED.created_at,
            finished_at = EXCLUDED.finished_at
        `).run(
          localRunId,
          localSuiteId,
          localHvId,
          (rDev.status || 'PENDING').toUpperCase(),
          typeof rDev.metrics === 'string' ? rDev.metrics : JSON.stringify(rDev.metrics || {}),
          rDev.created_at || new Date().toISOString(),
          rDev.finished_at
        );

        // Fetch results from devDb table: eval_run_results
        const resultsDev = devDb!.prepare('SELECT * FROM eval_run_results WHERE eval_run_id = ?').all(rDev.id) as any[];

        await db.prepare('DELETE FROM eval_results WHERE eval_run_id = ?').run(localRunId);

        for (const resDev of resultsDev) {
          const localCaseId = stringToIntegerId(resDev.eval_case_id);
          const existsCase = await db.prepare('SELECT id FROM eval_cases WHERE id = ?').get(localCaseId);
          if (!existsCase) {
            continue; // Skip result if case doesn't exist locally to prevent FK failure
          }

          await db.prepare(`
            INSERT INTO eval_results (eval_run_id, eval_case_id, status, score, raw_output, judge_metadata)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            localRunId,
            localCaseId,
            (resDev.status || 'FAIL').toUpperCase(),
            resDev.score || 0.0,
            typeof resDev.raw_output === 'string' ? resDev.raw_output : JSON.stringify(resDev.raw_output || {}),
            typeof resDev.judge_metadata === 'string' ? resDev.judge_metadata : JSON.stringify(resDev.judge_metadata || {})
          );
        }
      }
    });

    await syncTx();
    return true;
  } catch (err) {
    console.error('Error syncing eval runs from dev.db to autoharness.db:', err);
    return false;
  } finally {
    try {
      if (devDb) devDb.close();
    } catch {}
  }
}

