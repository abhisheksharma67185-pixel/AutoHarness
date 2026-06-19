import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const body = await req.json();
    const { name, benchmark_slug, description, failure_label_ids, scoring_strategy } = body;

    if (!name) {
      return sendError('VALIDATION_ERROR', 'Missing field name', { field: 'name' }, 400);
    }
    if (!benchmark_slug) {
      return sendError('VALIDATION_ERROR', 'Missing field benchmark_slug', { field: 'benchmark_slug' }, 400);
    }
    if (!description) {
      return sendError('VALIDATION_ERROR', 'Missing field description', { field: 'description' }, 400);
    }
    if (!failure_label_ids || !Array.isArray(failure_label_ids)) {
      return sendError('VALIDATION_ERROR', 'Missing or invalid field failure_label_ids', { field: 'failure_label_ids' }, 400);
    }

    // Resolve benchmark
    const { data: bench, error: benchError } = await supabaseServer
      .from('benchmarks')
      .select('id')
      .eq('slug', benchmark_slug)
      .maybeSingle();

    if (benchError) throw benchError;
    if (!bench) {
      return sendError('NOT_FOUND', `Benchmark not found with slug: ${benchmark_slug}`, { benchmark_slug }, 404);
    }

    // 1. Insert suite
    const { data: suite, error: suiteInsertError } = await supabaseServer
      .from('eval_suites')
      .insert({
        name,
        benchmark_id: bench.id,
        description
      })
      .select('id')
      .single();

    if (suiteInsertError) throw suiteInsertError;
    const evalSuiteId = suite.id;

    // 2. Promote failure labels to eval cases
    let caseCount = 0;
    for (const idStr of failure_label_ids) {
      const cleanId = idStr.startsWith('fl') ? idStr.slice(2) : idStr;
      const labelId = parseInt(cleanId, 10);

      if (isNaN(labelId)) continue;

      // Fetch failure label and task details
      const { data: details, error: detailsError } = await supabaseServer
        .from('failure_labels')
        .select(`
          id,
          run_tasks!inner (
            benchmark_task_id,
            benchmark_tasks!inner (
              task_id,
              title,
              metadata
            )
          )
        `)
        .eq('id', labelId)
        .maybeSingle();

      if (detailsError || !details) continue;

      const rt = Array.isArray(details.run_tasks) ? details.run_tasks[0] : details.run_tasks;
      const bt = rt?.benchmark_tasks as any;
      const benchmark_task_id = rt?.benchmark_task_id;
      const task_id = bt?.task_id;
      const slug = bt?.title;
      const bt_metadata = bt?.metadata;

      if (!benchmark_task_id) continue;

      let btMetaObj: any = {};
      try {
        btMetaObj = typeof bt_metadata === 'string' ? JSON.parse(bt_metadata) : (bt_metadata || {});
      } catch {}

      const inputSpec = JSON.stringify({
        task_id: task_id,
        slug: slug,
        original_instructions: btMetaObj.description || ''
      });

      const expectedSpec = JSON.stringify({
        assertions: [{ type: 'exit_code', expected: 0 }],
        strategy: scoring_strategy || 'benchmark_or_llm_judge'
      });

      // Insert eval case
      const { data: newCase, error: caseError } = await supabaseServer
        .from('eval_cases')
        .insert({
          benchmark_task_id,
          failure_label_id: labelId,
          input_spec: inputSpec,
          expected_spec: expectedSpec,
          scoring_config: '{}',
          created_by: 'MANUAL'
        })
        .select('id')
        .single();

      if (caseError || !newCase) continue;
      const evalCaseId = newCase.id;

      // Insert eval suite member
      const { error: memberError } = await supabaseServer
        .from('eval_suite_members')
        .insert({
          eval_suite_id: evalSuiteId,
          eval_case_id: evalCaseId
        });

      if (!memberError) {
        caseCount++;
      }
    }

    return sendSuccess({
      eval_suite_id: `es${evalSuiteId}`,
      case_count: caseCount
    }, 201);

  } catch (err: any) {
    console.error('Create eval suite error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error creating evaluation suite', null, 500);
  }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { searchParams } = new URL(req.url);
    const benchmarkSlug = searchParams.get('benchmark_slug');

    let query = supabaseServer
      .from('eval_suites')
      .select(`
        id,
        name,
        description,
        created_at,
        benchmarks!inner ( slug ),
        eval_suite_members ( eval_case_id )
      `);

    if (benchmarkSlug) {
      query = query.eq('benchmarks.slug', benchmarkSlug);
    }

    const { data: suites, error: suitesError } = await query;
    if (suitesError) throw suitesError;

    const formatted = (suites || []).map((s: any) => ({
      id: `es${s.id}`,
      name: s.name,
      benchmark_slug: s.benchmarks?.slug,
      description: s.description,
      case_count: Array.isArray(s.eval_suite_members) ? s.eval_suite_members.length : (s.eval_suite_members ? 1 : 0),
      created_at: new Date(s.created_at || Date.now()).toISOString()
    }));

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('List eval suites error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching evaluation suites', null, 500);
  }
}
