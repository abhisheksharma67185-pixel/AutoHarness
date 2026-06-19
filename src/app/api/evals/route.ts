import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchWithBypass } from '@/lib/api-helper';

const BACKEND = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/_/backend/api/v1`
  : 'http://localhost:8001/api/v1';

const fetch = fetchWithBypass;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const suite_id = searchParams.get('suite_id');

    if (suite_id) {
      const cleanIdStr = suite_id.startsWith('es') ? suite_id.slice(2) : suite_id;
      const suiteId = parseInt(cleanIdStr, 10);

      // Fetch suite
      const { data: suite, error: suiteError } = await supabaseServer
        .from('eval_suites')
        .select(`
          id, name, description, created_at,
          benchmarks!inner ( slug )
        `)
        .eq('id', suiteId)
        .single();

      if (suiteError || !suite) {
        return NextResponse.json({ error: 'Suite not found' }, { status: 404 });
      }

      // Fetch cases through eval_suite_members
      const { data: casesRows } = await supabaseServer
        .from('eval_suite_members')
        .select(`
          eval_cases!inner (
            id,
            benchmark_task_id,
            input_spec,
            expected_spec,
            benchmark_tasks (
              task_id,
              metadata
            )
          )
        `)
        .eq('eval_suite_id', suiteId);

      const cases = (casesRows || []).map((row: any) => {
        const c = row.eval_cases;
        let inputObj: any = {};
        let expectedObj: any = {};
        let btMetaObj: any = {};
        try { inputObj = typeof c.input_spec === 'string' ? JSON.parse(c.input_spec) : (c.input_spec || {}); } catch {}
        try { expectedObj = typeof c.expected_spec === 'string' ? JSON.parse(c.expected_spec) : (c.expected_spec || {}); } catch {}
        try { btMetaObj = typeof c.benchmark_tasks?.metadata === 'string' ? JSON.parse(c.benchmark_tasks.metadata) : (c.benchmark_tasks?.metadata || {}); } catch {}
        return {
          id: c.id,
          task_id: c.benchmark_task_id || c.id,
          slug: c.benchmark_tasks?.task_id || 'N/A',
          category: inputObj.category || 'unknown',
          difficulty: inputObj.difficulty || 'medium',
          description: inputObj.original_instructions || inputObj.description || btMetaObj.description || '',
          input_spec: typeof c.input_spec === 'string' ? c.input_spec : JSON.stringify(c.input_spec || {}),
          expected_spec: typeof c.expected_spec === 'string' ? c.expected_spec : JSON.stringify(c.expected_spec || {}),
        };
      });

      // Fetch eval runs for this suite
      const { data: runsRows } = await supabaseServer
        .from('eval_runs')
        .select(`
          id, created_at, status, metrics,
          harness_versions ( name )
        `)
        .eq('eval_suite_id', suiteId)
        .order('id', { ascending: false });

      const runs = (runsRows || []).map((r: any) => {
        let metricsObj: any = {};
        try {
          metricsObj = typeof r.metrics === 'string' ? JSON.parse(r.metrics) : (r.metrics || {});
        } catch {}
        return {
          id: r.id,
          created_at: r.created_at,
          status: r.status,
          metrics: typeof r.metrics === 'string' ? r.metrics : JSON.stringify(r.metrics || {}),
          harness_version: r.harness_versions?.name || 'Unknown',
          agent: 'N/A',
          pass_rate: metricsObj.pass_rate ?? 0,
        };
      });

      return NextResponse.json({
        suite: {
          id: suite.id,
          name: suite.name,
          description: suite.description,
          benchmark_id: (suite as any).benchmarks?.slug,
        },
        cases,
        runs
      });
    }

    // List all suites with case counts
    const { data: suitesRows, error: suitesError } = await supabaseServer
      .from('eval_suites')
      .select(`
        id, name, description,
        benchmarks!inner ( slug ),
        eval_suite_members ( eval_case_id )
      `)
      .order('id', { ascending: true });

    if (suitesError) {
      throw suitesError;
    }

    const suites = (suitesRows || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      benchmark_id: s.benchmarks?.slug,
      case_count: Array.isArray(s.eval_suite_members) ? s.eval_suite_members.length : 0,
      recent_pass_rate: null,
      recent_harness_version: null,
    }));

    return NextResponse.json({ evalSuites: suites });
  } catch (err: any) {
    console.error('Evals query error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // Action A: Create new evaluation suite via FastAPI
    if (action === 'create_suite') {
      const { name, description } = body;
      if (!name || !description) {
        return NextResponse.json({ error: 'Missing name or description' }, { status: 400 });
      }

      const res = await fetch(`${BACKEND}/eval-suites/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          benchmark_slug: 'terminal-bench@2.0',
          source_type: 'manual',
          scoring_strategy: 'benchmark_native',
          case_count: 0,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: data.detail || 'Failed to create suite' }, { status: res.status });
      }

      const suiteId = data.data?.id || data.id;

      return NextResponse.json({
        success: true,
        suite_id: suiteId,
        message: `Eval suite "${name}" created successfully.`,
      });
    }

    // Action A2: Create evaluation suite from failure mode via FastAPI
    if (action === 'create_suite_from_failure_mode') {
      const { name, description, failure_mode_id, max_cases } = body;
      if (!name || !description || !failure_mode_id) {
        return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
      }

      const res = await fetch(`${BACKEND}/eval-suites/from-failure-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          failure_mode_id,
          name,
          description,
          max_cases: max_cases || 20,
          scoring_strategy: 'benchmark_native'
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: data.detail || 'Failed to create suite' }, { status: res.status });
      }

      const suiteId = data.data?.id || data.id;

      return NextResponse.json({
        success: true,
        suite_id: suiteId,
        message: `Eval suite "${name}" created successfully from failure mode.`,
      });
    }

    // Action B: Promote failed task to an eval case (via FastAPI)
    if (action === 'promote_failure') {
      const { run_task_id, eval_suite_id } = body;
      if (!run_task_id || !eval_suite_id) {
        return NextResponse.json({ error: 'Missing run_task_id or eval_suite_id' }, { status: 400 });
      }

      // Fetch task from backend
      const taskRes = await fetch(`${BACKEND}/tasks/${run_task_id}`, { cache: 'no-store' });
      if (!taskRes.ok) {
        return NextResponse.json({ error: 'Run task not found' }, { status: 404 });
      }
      const taskData = await taskRes.json();
      const runTask = taskData.data || taskData;

      // Build eval case payload
      const inputSpec = {
        task_id: runTask.benchmark_task_id,
        slug: runTask.task_slug,
        original_instructions: runTask.description || '',
        setup_required: 'Setup corresponding repository workspace environment.',
      };

      const res = await fetch(`${BACKEND}/eval-suites/${eval_suite_id}/cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eval_suite_id,
          failure_label_id: runTask.failure_label?.id || null,
          run_task_id: run_task_id,
          run_id: runTask.run_id,
          benchmark_task_id: runTask.benchmark_task_id,
          input_spec: inputSpec,
          expected_spec: { diagnosis: runTask.diagnosis_text || 'Unknown failure' },
          scoring_strategy: 'benchmark_native',
          weight: 1.0,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: data.detail || 'Failed to promote failure' }, { status: res.status });
      }

      return NextResponse.json({
        success: true,
        eval_case_id: data.data?.id || data.id,
        message: 'Task successfully promoted to Eval Case and linked to suite.',
      });
    }

    return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });

  } catch (err: any) {
    console.error('Evals POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
