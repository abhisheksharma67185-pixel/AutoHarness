import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';

interface Params {
  params: Promise<{
    id: string;
    variant_id: string;
  }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { id, variant_id } = await params;
    const cleanId = id.startsWith('exp') ? id.slice(3) : id;
    const expIdNum = parseInt(cleanId, 10);

    const cleanVariantId = variant_id.startsWith('ev') ? variant_id.slice(2) : variant_id;
    const variantIdNum = parseInt(cleanVariantId, 10);

    if (isNaN(expIdNum) || isNaN(variantIdNum)) {
      return sendError('VALIDATION_ERROR', 'Invalid experiment_id or variant_id format', null, 400);
    }

    const body = await req.json();
    const { run_id } = body;

    if (!run_id) {
      return sendError('VALIDATION_ERROR', 'Missing field run_id', { field: 'run_id' }, 400);
    }

    // Check experiment exists
    const exp = await db.prepare('SELECT * FROM experiments WHERE id = ?').get(expIdNum) as any;
    if (!exp) {
      return sendError('NOT_FOUND', `Experiment not found with ID: ${id}`, { experiment_id: id }, 404);
    }

    // Check variant exists
    const variant = await db.prepare('SELECT * FROM experiment_variants WHERE id = ? AND experiment_id = ?').get(variantIdNum, expIdNum) as any;
    if (!variant) {
      return sendError('NOT_FOUND', `Variant not found with ID: ${variant_id} for experiment: ${id}`, { variant_id }, 404);
    }

    // Check run exists, if not sync it from dev.db
    let newRun = await db.prepare('SELECT * FROM runs WHERE id = ?').get(run_id) as any;
    if (!newRun) {
      const { syncRunDevToLocal } = await import('@/lib/ingest-helper');
      const synced = await syncRunDevToLocal(run_id);
      if (synced) {
        newRun = await db.prepare('SELECT * FROM runs WHERE id = ?').get(run_id) as any;
      }
    }

    if (!newRun) {
      return sendError('NOT_FOUND', `Run not found with ID: ${run_id}`, { run_id }, 404);
    }

    // Helper function to run evaluation
    const runEvaluation = async (suiteId: number, harnessVersionId: number) => {
      // Insert pending eval_runs record
      const erResult = await db.prepare(`
        INSERT INTO eval_runs (eval_suite_id, harness_version_id, status, metrics)
        VALUES (?, ?, 'PENDING', '{}')
      `).run(suiteId, harnessVersionId);
      const evalRunId = erResult.lastInsertRowid;

      // Get cases in suite
      const cases = await db.prepare(`
        SELECT ec.*
        FROM eval_cases ec
        JOIN eval_suite_members esm ON ec.id = esm.eval_case_id
        WHERE esm.eval_suite_id = ?
      `).all(suiteId) as any[];

      let passedCount = 0;
      let scoreSum = 0;

      for (const c of cases) {
        const runTask = await db.prepare(`
          SELECT rt.status, rt.score
          FROM run_tasks rt
          JOIN runs r ON rt.run_id = r.id
          WHERE r.harness_version_id = ? AND rt.benchmark_task_id = ?
          ORDER BY r.created_at DESC
          LIMIT 1
        `).get(harnessVersionId, c.benchmark_task_id) as any;

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

      return { evalRunId: Number(evalRunId), passRate };
    };

    // Update the run's harness_version_id so it links
    await db.prepare('UPDATE runs SET harness_version_id = ? WHERE id = ?')
      .run(variant.harness_version_id, run_id);

    // Fetch baseline run details
    const baseRun = await db.prepare(`
      SELECT * FROM runs
      WHERE harness_version_id = ? AND benchmark_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(exp.base_harness_version_id, exp.benchmark_id) as any;

    const baseScore = baseRun ? baseRun.global_score : 0.4;
    const newScore = newRun.global_score;

    // Load policy
    const policy = JSON.parse(exp.regression_policy || '{}');

    // Fetch all suites under the benchmark
    const suites = await db.prepare('SELECT id, name FROM eval_suites WHERE benchmark_id = ?').all(exp.benchmark_id) as any[];

    // Start transaction to run evaluations and write summaries
    const transaction = db.transaction(async () => {
      await db.prepare('DELETE FROM experiment_variant_eval_summaries WHERE experiment_variant_id = ?').run(variantIdNum);

      for (const suite of suites) {
        const suiteId = suite.id;

        // Fetch or create baseline eval run
        let baselineEvalRun = await db.prepare(`
          SELECT id, metrics FROM eval_runs
          WHERE eval_suite_id = ? AND harness_version_id = ? AND status = 'COMPLETED'
          ORDER BY created_at DESC
          LIMIT 1
        `).get(suiteId, exp.base_harness_version_id) as any;

        let baselineEvalRunId = 0;
        let baselinePassRate = 0.0;

        if (baselineEvalRun) {
          baselineEvalRunId = baselineEvalRun.id;
          try {
            baselinePassRate = JSON.parse(baselineEvalRun.metrics).pass_rate || 0.0;
          } catch {}
        } else {
          const res = await runEvaluation(suiteId, exp.base_harness_version_id);
          baselineEvalRunId = res.evalRunId;
          baselinePassRate = res.passRate;
        }

        // Run evaluation for variant's harness version
        const variantRes = await runEvaluation(suiteId, variant.harness_version_id);
        const variantEvalRunId = variantRes.evalRunId;
        const variantPassRate = variantRes.passRate;

        const deltaPassRate = variantPassRate - baselinePassRate;

        // Determine regression flag for this suite
        let regressionFlag = 0;

        // Check if there is an explicit guard suite policy
        const guardSuites = policy.guard_suites || [];
        const matchingGuard = guardSuites.find((g: any) => {
          const cleanGuardId = g.eval_suite_id.startsWith('es') ? g.eval_suite_id.slice(2) : g.eval_suite_id;
          return parseInt(cleanGuardId, 10) === suiteId;
        });

        const isSafetyOrCritical = (suite.name || '').toLowerCase().includes('safety') || (suite.name || '').toLowerCase().includes('critical');
        let maxAllowedDrop = isSafetyOrCritical ? 0.0 : 0.02;

        if (matchingGuard) {
          maxAllowedDrop = matchingGuard.max_allowed_drop !== undefined ? matchingGuard.max_allowed_drop : maxAllowedDrop;
        }

        if (isSafetyOrCritical) {
          maxAllowedDrop = 0.0; // Enforce strict zero regression
        }

        if (baselinePassRate - variantPassRate > maxAllowedDrop) {
          regressionFlag = 1;
        }

        // Check legacy max_regression_pct
        const maxRegressionPct = policy.max_regression_pct !== undefined ? policy.max_regression_pct : 2.0;
        if (baseScore - newScore > (maxRegressionPct / 100)) {
          regressionFlag = 1;
        }

        // Check global minimum success rate
        const minSuccessRate = policy.global_min_success_rate !== undefined ? policy.global_min_success_rate : 0.55;
        if (newScore < minSuccessRate) {
          regressionFlag = 1;
        }

        await db.prepare(`
          INSERT INTO experiment_variant_eval_summaries (experiment_variant_id, eval_suite_id, baseline_eval_run_id, variant_eval_run_id, delta_pass_rate, regression_flag)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(variantIdNum, suiteId, baselineEvalRunId, variantEvalRunId, deltaPassRate, regressionFlag);
      }

      // Update variant status to 'EVALUATED'
      await db.prepare("UPDATE experiment_variants SET status = 'EVALUATED' WHERE id = ?").run(variantIdNum);
    });

    await transaction();

    return sendSuccess({
      linked: true
    });

  } catch (err: any) {
    console.error('Link variant run error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error linking run to variant', null, 500);
  }
}
