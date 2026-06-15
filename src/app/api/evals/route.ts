import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
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

      const suite = db.prepare(`
        SELECT es.id, es.name, es.description, es.created_at, b.slug as benchmark_slug
        FROM eval_suites es
        JOIN benchmarks b ON es.benchmark_id = b.id
        WHERE es.id = ?
      `).get(suiteId) as any;

      if (!suite) {
        return NextResponse.json({ error: 'Suite not found' }, { status: 404 });
      }

      const casesRows = db.prepare(`
        SELECT ec.id, ec.benchmark_task_id, ec.input_spec, ec.expected_spec, bt.task_id as slug
        FROM eval_cases ec
        JOIN eval_suite_members esm ON ec.id = esm.eval_case_id
        LEFT JOIN benchmark_tasks bt ON ec.benchmark_task_id = bt.id
        WHERE esm.eval_suite_id = ?
      `).all(suiteId) as any[];

      const cases = casesRows.map(c => {
        let inputObj: any = {};
        let expectedObj: any = {};
        try { inputObj = JSON.parse(c.input_spec); } catch {}
        try { expectedObj = JSON.parse(c.expected_spec); } catch {}
        return {
          id: c.id,
          task_id: c.benchmark_task_id || c.id,
          slug: c.slug || 'N/A',
          category: inputObj.category || 'unknown',
          difficulty: inputObj.difficulty || 'medium',
          description: inputObj.original_instructions || inputObj.description || '',
          input_spec: c.input_spec,
          expected_spec: c.expected_spec,
        };
      });

      const runsRows = db.prepare(`
        SELECT er.id, er.created_at, er.status, er.metrics, hv.name as harness_version_id
        FROM eval_runs er
        LEFT JOIN harness_versions hv ON er.harness_version_id = hv.id
        WHERE er.eval_suite_id = ?
        ORDER BY er.id DESC
      `).all(suiteId) as any[];

      const runs = runsRows.map(r => {
        let metricsObj: any = {};
        try { metricsObj = JSON.parse(r.metrics); } catch {}
        return {
          id: r.id,
          created_at: r.created_at,
          status: r.status,
          metrics: r.metrics,
          harness_version: r.harness_version_id || 'Unknown',
          agent: 'N/A',
          pass_rate: metricsObj.pass_rate ?? 0,
        };
      });

      return NextResponse.json({
        suite: {
          id: suite.id,
          name: suite.name,
          description: suite.description,
          benchmark_id: suite.benchmark_slug,
        },
        cases,
        runs
      });
    }

    const suitesRows = db.prepare(`
      SELECT es.id, es.name, es.description, b.slug as benchmark_slug,
             COUNT(esm.eval_case_id) as case_count
      FROM eval_suites es
      JOIN benchmarks b ON es.benchmark_id = b.id
      LEFT JOIN eval_suite_members esm ON es.id = esm.eval_suite_id
      GROUP BY es.id
      ORDER BY es.id ASC
    `).all() as any[];

    const suites = suitesRows.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      benchmark_id: s.benchmark_slug,
      case_count: s.case_count || 0,
      recent_pass_rate: null,
      recent_harness_version: null,
    }));

    return NextResponse.json({ evalSuites: suites });
  } catch (err: any) {
    console.error('Direct evals query failed, falling back to HTTP:', err);
    try {
      const { searchParams } = new URL(req.url);
      const suite_id = searchParams.get('suite_id');

      if (suite_id) {
        const [suiteRes, casesRes, runsRes] = await Promise.all([
          fetch(`${BACKEND}/eval-suites/${suite_id}`, { cache: 'no-store' }),
          fetch(`${BACKEND}/eval-suites/${suite_id}/cases`, { cache: 'no-store' }),
          fetch(`${BACKEND}/eval-runs?eval_suite_id=${encodeURIComponent(suite_id)}`, { cache: 'no-store' }),
        ]);

        if (!suiteRes.ok) {
          const d = await suiteRes.json().catch(() => ({}));
          return NextResponse.json({ error: d.detail || 'Suite not found' }, { status: suiteRes.status });
        }

        const suiteData = await suiteRes.json();
        const casesData = casesRes.ok ? await casesRes.json().catch(() => ({ data: [] })) : { data: [] };
        const runsData = runsRes.ok ? await runsRes.json().catch(() => ({ data: [] })) : { data: [] };

        const suite = suiteData.data || suiteData;

        const cases = (casesData.data || []).map((c: any) => ({
          id: c.id,
          task_id: c.benchmark_task_id || c.id,
          slug: c.benchmark_task_id || 'N/A',
          category: c.input_spec?.category || 'unknown',
          difficulty: c.input_spec?.difficulty || 'medium',
          description: c.input_spec?.original_instructions || c.input_spec?.description || '',
          input_spec: typeof c.input_spec === 'string' ? c.input_spec : JSON.stringify(c.input_spec || {}),
          expected_spec: typeof c.expected_spec === 'string' ? c.expected_spec : JSON.stringify(c.expected_spec || {}),
        }));

        const runs = (runsData.data || []).map((r: any) => ({
          id: r.id,
          created_at: r.created_at,
          status: r.status,
          metrics: typeof r.metrics === 'string' ? r.metrics : JSON.stringify(r.metrics || {}),
          harness_version: r.harness_version_id || 'Unknown',
          agent: r.experiment_variant_id || 'N/A',
          pass_rate: r.metrics?.pass_rate ?? (typeof r.metrics === 'string' ? JSON.parse(r.metrics || '{}')?.pass_rate ?? 0 : 0),
        }));

        return NextResponse.json({ suite, cases, runs });
      }

      const res = await fetch(`${BACKEND}/eval-suites/`, { cache: 'no-store' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return NextResponse.json({ error: d.detail || 'Failed to fetch suites' }, { status: res.status });
      }
      const data = await res.json();
      const suites = (data.data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        benchmark_id: s.benchmark_slug,
        case_count: s.case_count ?? 0,
        recent_pass_rate: null,
        recent_harness_version: null,
      }));

      return NextResponse.json({ evalSuites: suites });
    } catch (fallbackErr: any) {
      return NextResponse.json({ error: fallbackErr.message }, { status: 500 });
    }
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
      if (suiteId) {
        try {
          const { syncEvalSuitesDevToLocal } = await import('@/lib/ingest-helper');
          syncEvalSuitesDevToLocal(suiteId);
        } catch (syncErr) {
          console.error('Failed to sync new eval suite:', syncErr);
        }
      }

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
      if (suiteId) {
        try {
          const { syncEvalSuitesDevToLocal } = await import('@/lib/ingest-helper');
          syncEvalSuitesDevToLocal(suiteId);
        } catch (syncErr) {
          console.error('Failed to sync new failure mode eval suite:', syncErr);
        }
      }

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

      if (eval_suite_id) {
        try {
          const { syncEvalSuitesDevToLocal } = await import('@/lib/ingest-helper');
          syncEvalSuitesDevToLocal(eval_suite_id);
        } catch (syncErr) {
          console.error('Failed to sync eval suite after promoting failure:', syncErr);
        }
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
