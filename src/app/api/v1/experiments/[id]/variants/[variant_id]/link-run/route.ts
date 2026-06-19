import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
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
    const { data: exp, error: expError } = await supabaseServer
      .from('experiments')
      .select('*')
      .eq('id', expIdNum)
      .maybeSingle();

    if (expError) throw expError;
    if (!exp) {
      return sendError('NOT_FOUND', `Experiment not found with ID: ${id}`, { experiment_id: id }, 404);
    }

    // Check variant exists
    const { data: variant, error: varError } = await supabaseServer
      .from('experiment_variants')
      .select('*')
      .eq('id', variantIdNum)
      .eq('experiment_id', expIdNum)
      .maybeSingle();

    if (varError) throw varError;
    if (!variant) {
      return sendError('NOT_FOUND', `Variant not found with ID: ${variant_id} for experiment: ${id}`, { variant_id }, 404);
    }

    // Check run exists
    const { data: newRun, error: newRunError } = await supabaseServer
      .from('runs')
      .select('*')
      .eq('id', run_id)
      .maybeSingle();

    if (newRunError) throw newRunError;
    if (!newRun) {
      return sendError('NOT_FOUND', `Run not found with ID: ${run_id}`, { run_id }, 404);
    }

    // Helper function to run evaluation
    const runEvaluation = async (suiteId: number, harnessVersionId: number) => {
      // Insert pending eval_runs record
      const { data: erRow, error: erInsertError } = await supabaseServer
        .from('eval_runs')
        .insert({
          eval_suite_id: suiteId,
          harness_version_id: harnessVersionId,
          status: 'PENDING',
          metrics: '{}'
        })
        .select('id')
        .single();

      if (erInsertError || !erRow) throw erInsertError || new Error('Failed to create eval_run');
      const evalRunId = erRow.id;

      // Get cases in suite
      const { data: members, error: membersError } = await supabaseServer
        .from('eval_suite_members')
        .select(`
          eval_cases (
            id,
            benchmark_task_id
          )
        `)
        .eq('eval_suite_id', suiteId);
      if (membersError) throw membersError;

      const cases = (members || []).map((m: any) => m.eval_cases).filter(Boolean) as any[];

      let passedCount = 0;
      let scoreSum = 0;

      for (const c of cases) {
        const { data: runTasks, error: rtError } = await supabaseServer
          .from('run_tasks')
          .select(`
            status,
            score,
            runs!inner (
              harness_version_id,
              created_at
            )
          `)
          .eq('benchmark_task_id', c.benchmark_task_id)
          .eq('runs.harness_version_id', harnessVersionId);

        if (rtError) throw rtError;

        const sortedRt = (runTasks || []).sort((a: any, b: any) => {
          const timeA = new Date(a.runs?.created_at || 0).getTime();
          const timeB = new Date(b.runs?.created_at || 0).getTime();
          return timeB - timeA;
        });

        const runTask = sortedRt[0];

        const caseStatus = runTask ? runTask.status : 'FAIL';
        const caseScore = runTask ? runTask.score : 0.0;

        if (caseStatus === 'PASS') passedCount++;
        scoreSum += caseScore;

        const { error: resultError } = await supabaseServer
          .from('eval_results')
          .insert({
            eval_run_id: evalRunId,
            eval_case_id: c.id,
            status: caseStatus,
            score: caseScore,
            raw_output: '{}',
            judge_metadata: '{}'
          });
        if (resultError) throw resultError;
      }

      const totalCases = cases.length;
      const passRate = totalCases > 0 ? passedCount / totalCases : 0.0;
      const avgScore = totalCases > 0 ? scoreSum / totalCases : 0.0;

      const metricsObj = {
        pass_rate: passRate,
        avg_score: avgScore,
        num_cases: totalCases
      };

      const { error: updateEvalRunError } = await supabaseServer
        .from('eval_runs')
        .update({
          status: 'COMPLETED',
          metrics: JSON.stringify(metricsObj),
          finished_at: new Date().toISOString()
        })
        .eq('id', evalRunId);
      if (updateEvalRunError) throw updateEvalRunError;

      return { evalRunId, passRate };
    };

    // Update the run's harness_version_id so it links
    const { error: linkRunError } = await supabaseServer
      .from('runs')
      .update({ harness_version_id: variant.harness_version_id })
      .eq('id', run_id);
    if (linkRunError) throw linkRunError;

    // Fetch baseline run details
    const { data: runs, error: baseRunError } = await supabaseServer
      .from('runs')
      .select('*')
      .eq('harness_version_id', exp.base_harness_version_id)
      .eq('benchmark_id', exp.benchmark_id);

    if (baseRunError) throw baseRunError;

    const sortedRuns = (runs || []).sort((a: any, b: any) => {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
    const baseRun = sortedRuns[0];

    const baseScore = baseRun ? baseRun.global_score : 0.4;
    const newScore = newRun.global_score;

    // Load policy
    const policy = typeof exp.regression_policy === 'string' ? JSON.parse(exp.regression_policy || '{}') : (exp.regression_policy || {});

    // Fetch all suites under the benchmark
    const { data: suites, error: suitesError } = await supabaseServer
      .from('eval_suites')
      .select('id, name')
      .eq('benchmark_id', exp.benchmark_id);

    if (suitesError) throw suitesError;

    // Clear previous variant summaries
    const { error: deleteSummariesError } = await supabaseServer
      .from('experiment_variant_eval_summaries')
      .delete()
      .eq('experiment_variant_id', variantIdNum);
    if (deleteSummariesError) throw deleteSummariesError;

    for (const suite of (suites || [])) {
      const suiteId = suite.id;

      // Fetch baseline eval run
      const { data: baselineRuns, error: brError } = await supabaseServer
        .from('eval_runs')
        .select('id, metrics, created_at')
        .eq('eval_suite_id', suiteId)
        .eq('harness_version_id', exp.base_harness_version_id)
        .eq('status', 'COMPLETED');

      if (brError) throw brError;

      const sortedBr = (baselineRuns || []).sort((a: any, b: any) => {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
      const baselineEvalRun = sortedBr[0];

      let baselineEvalRunId = 0;
      let baselinePassRate = 0.0;

      if (baselineEvalRun) {
        baselineEvalRunId = baselineEvalRun.id;
        try {
          const m = typeof baselineEvalRun.metrics === 'string' ? JSON.parse(baselineEvalRun.metrics) : baselineEvalRun.metrics;
          baselinePassRate = m?.pass_rate || 0.0;
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

      const { error: summaryInsertError } = await supabaseServer
        .from('experiment_variant_eval_summaries')
        .insert({
          experiment_variant_id: variantIdNum,
          eval_suite_id: suiteId,
          baseline_eval_run_id: baselineEvalRunId,
          variant_eval_run_id: variantEvalRunId,
          delta_pass_rate: deltaPassRate,
          regression_flag: regressionFlag
        });
      if (summaryInsertError) throw summaryInsertError;
    }

    // Update variant status to 'EVALUATED'
    const { error: updateStatusError } = await supabaseServer
      .from('experiment_variants')
      .update({ status: 'EVALUATED' })
      .eq('id', variantIdNum);
    if (updateStatusError) throw updateStatusError;

    return sendSuccess({
      linked: true
    });

  } catch (err: any) {
    console.error('Link variant run error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error linking run to variant', null, 500);
  }
}
