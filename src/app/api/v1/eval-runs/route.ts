import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';
import { runOnlineEvaluation } from '@/lib/online-runner';

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const body = await req.json();
    const { eval_suite_id, harness_version_id, mode } = body;

    if (!eval_suite_id) {
      return sendError('VALIDATION_ERROR', 'Missing field eval_suite_id', { field: 'eval_suite_id' }, 400);
    }
    if (!harness_version_id) {
      return sendError('VALIDATION_ERROR', 'Missing field harness_version_id', { field: 'harness_version_id' }, 400);
    }

    // Clean suite ID
    const cleanSuiteId = eval_suite_id.startsWith('es') ? eval_suite_id.slice(2) : eval_suite_id;
    const suiteIdNum = parseInt(cleanSuiteId, 10);
    const suite = await db.prepare('SELECT * FROM eval_suites WHERE id = ?').get(suiteIdNum) as any;

    if (!suite) {
      return sendError('NOT_FOUND', `Eval suite not found with ID: ${eval_suite_id}`, { eval_suite_id }, 404);
    }

    // Clean harness version ID
    let harnessName = harness_version_id;
    if (harnessName.startsWith('hv-')) {
      harnessName = harnessName.slice(3);
    }
    let hv = await db.prepare('SELECT id, name FROM harness_versions WHERE name = ?').get(harnessName) as any;
    if (!hv) {
      const hvIdNum = parseInt(harnessName, 10);
      if (!isNaN(hvIdNum)) {
        hv = await db.prepare('SELECT id, name FROM harness_versions WHERE id = ?').get(hvIdNum) as any;
      }
    }

    if (!hv) {
      return sendError('NOT_FOUND', `Harness version not found: ${harness_version_id}`, { harness_version_id }, 404);
    }

    // Insert pending eval_runs record
    const erResult = await db.prepare(`
      INSERT INTO eval_runs (eval_suite_id, harness_version_id, status, metrics)
      VALUES (?, ?, 'PENDING', '{}')
    `).run(suite.id, hv.id);
    const evalRunId = erResult.lastInsertRowid;

    if (mode === 'online_rerun') {
      // Execute the online sandbox evaluation loop in the background
      runOnlineEvaluation(Number(evalRunId), suite.id, hv.id).catch(console.error);

      return sendSuccess({
        eval_run_id: `er${evalRunId}`,
        status: 'pending'
      }, 202);
    }

    // Get cases in suite
    const cases = await db.prepare(`
      SELECT ec.*
      FROM eval_cases ec
      JOIN eval_suite_members esm ON ec.id = esm.eval_case_id
      WHERE esm.eval_suite_id = ?
    `).all(suite.id) as any[];

    // Synchronously execute offline replay to update results
    let passedCount = 0;
    let scoreSum = 0;

    for (const c of cases) {
      // Find run task that matches harness version and case's benchmark task
      const runTask = await db.prepare(`
        SELECT rt.status, rt.score
        FROM run_tasks rt
        JOIN runs r ON rt.run_id = r.id
        WHERE r.harness_version_id = ? AND rt.benchmark_task_id = ?
        ORDER BY r.created_at DESC
        LIMIT 1
      `).get(hv.id, c.benchmark_task_id) as any;

      const caseStatus = runTask ? runTask.status : 'FAIL';
      const caseScore = runTask ? runTask.score : 0.0;

      if (caseStatus === 'PASS') passedCount++;
      scoreSum += caseScore;

      await db.prepare(`
        INSERT INTO eval_results (eval_run_id, eval_case_id, status, score, raw_output, judge_metadata)
        VALUES (?, ?, ?, ?, '{}', '{}')
      `).run(evalRunId, c.id, caseStatus, caseScore);
    }

    const totalCases = cases.length;
    const passRate = totalCases > 0 ? passedCount / totalCases : 0.0;
    const avgScore = totalCases > 0 ? scoreSum / totalCases : 0.0;

    const metricsObj = {
      pass_rate: passRate,
      avg_score: avgScore,
      num_cases: totalCases
    };

    await db.prepare(`
      UPDATE eval_runs
      SET status = 'COMPLETED', metrics = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(metricsObj), evalRunId);

    return sendSuccess({
      eval_run_id: `er${evalRunId}`,
      status: 'completed'
    }, 200);

  } catch (err: any) {
    console.error('Create eval run error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error executing evaluation run', null, 500);
  }
}
