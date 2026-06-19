import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
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
    
    const { data: suite, error: suiteError } = await supabaseServer
      .from('eval_suites')
      .select('id, name')
      .eq('id', suiteIdNum)
      .maybeSingle();

    if (suiteError) throw suiteError;
    if (!suite) {
      return sendError('NOT_FOUND', `Eval suite not found with ID: ${eval_suite_id}`, { eval_suite_id }, 404);
    }

    // Clean harness version ID
    let harnessName = harness_version_id;
    if (harnessName.startsWith('hv-')) {
      harnessName = harnessName.slice(3);
    }

    let hv: any = null;
    const { data: hvByName, error: hvNameError } = await supabaseServer
      .from('harness_versions')
      .select('id, name')
      .eq('name', harnessName)
      .maybeSingle();

    if (hvNameError) throw hvNameError;

    if (hvByName) {
      hv = hvByName;
    } else {
      const hvIdNum = parseInt(harnessName, 10);
      if (!isNaN(hvIdNum)) {
        const { data: hvById, error: hvIdError } = await supabaseServer
          .from('harness_versions')
          .select('id, name')
          .eq('id', hvIdNum)
          .maybeSingle();
        if (hvIdError) throw hvIdError;
        if (hvById) hv = hvById;
      }
    }

    if (!hv) {
      return sendError('NOT_FOUND', `Harness version not found: ${harness_version_id}`, { harness_version_id }, 404);
    }

    // Insert pending eval_runs record
    const { data: erRow, error: erInsertError } = await supabaseServer
      .from('eval_runs')
      .insert({
        eval_suite_id: suite.id,
        harness_version_id: hv.id,
        status: 'PENDING',
        metrics: '{}'
      })
      .select('id')
      .single();

    if (erInsertError || !erRow) throw erInsertError || new Error('Failed to create eval_run');
    const evalRunId = erRow.id;

    if (mode === 'online_rerun') {
      // Execute the online sandbox evaluation loop in the background
      runOnlineEvaluation(Number(evalRunId), suite.id, hv.id).catch(console.error);

      return sendSuccess({
        eval_run_id: `er${evalRunId}`,
        status: 'pending'
      }, 202);
    }

    // Get cases in suite
    const { data: members, error: membersError } = await supabaseServer
      .from('eval_suite_members')
      .select(`
        eval_cases (
          id,
          benchmark_task_id
        )
      `)
      .eq('eval_suite_id', suite.id);

    if (membersError) throw membersError;

    const cases = (members || []).map((m: any) => m.eval_cases).filter(Boolean) as any[];

    // Synchronously execute offline replay to update results
    let passedCount = 0;
    let scoreSum = 0;

    for (const c of cases) {
      // Find run task that matches harness version and case's benchmark task
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
        .eq('runs.harness_version_id', hv.id);

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

      const { error: resultInsertError } = await supabaseServer
        .from('eval_results')
        .insert({
          eval_run_id: evalRunId,
          eval_case_id: c.id,
          status: caseStatus,
          score: caseScore,
          raw_output: '{}',
          judge_metadata: '{}'
        });
      if (resultInsertError) throw resultInsertError;
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

    return sendSuccess({
      eval_run_id: `er${evalRunId}`,
      status: 'completed'
    }, 200);

  } catch (err: any) {
    console.error('Create eval run error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error executing evaluation run', null, 500);
  }
}
