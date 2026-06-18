import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
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
    const bench = await db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(benchmark_slug) as any;
    if (!bench) {
      return sendError('NOT_FOUND', `Benchmark not found with slug: ${benchmark_slug}`, { benchmark_slug }, 404);
    }

    const suiteTx = db.transaction(async () => {
      // 1. Insert suite
      const suiteResult = await db.prepare(`
        INSERT INTO eval_suites (name, benchmark_id, description)
        VALUES (?, ?, ?)
        RETURNING id
      `).run(name, bench.id, description);
      const evalSuiteId = suiteResult.lastInsertRowid;

      // 2. Promote failure labels to eval cases
      let caseCount = 0;
      for (const idStr of failure_label_ids) {
        const cleanId = idStr.startsWith('fl') ? idStr.slice(2) : idStr;
        const labelId = parseInt(cleanId, 10);

        if (isNaN(labelId)) continue;

        // Fetch failure label and task details
        const details = await db.prepare(`
          SELECT fl.id as failure_label_id, rt.benchmark_task_id, bt.task_id, bt.title as slug,
                 bt.metadata as bt_metadata
          FROM failure_labels fl
          JOIN run_tasks rt ON fl.run_task_id = rt.id
          JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
          WHERE fl.id = ?
        `).get(labelId) as any;

        if (!details) continue;

        let btMetaObj: any = {};
        try { btMetaObj = JSON.parse(details.bt_metadata || '{}'); } catch {}

        const inputSpec = JSON.stringify({
          task_id: details.task_id,
          slug: details.slug,
          original_instructions: btMetaObj.description || ''
        });

        const expectedSpec = JSON.stringify({
          assertions: [{ type: 'exit_code', expected: 0 }],
          strategy: scoring_strategy || 'benchmark_or_llm_judge'
        });

        // Insert eval case
        const caseResult = await db.prepare(`
          INSERT INTO eval_cases (benchmark_task_id, failure_label_id, input_spec, expected_spec, scoring_config, created_by)
          VALUES (?, ?, ?, ?, ?, 'MANUAL')
          RETURNING id
        `).run(details.benchmark_task_id, details.failure_label_id, inputSpec, expectedSpec, '{}');
        const evalCaseId = caseResult.lastInsertRowid;

        // Insert eval suite member
        await db.prepare(`
          INSERT INTO eval_suite_members (eval_suite_id, eval_case_id)
          VALUES (?, ?)
          ON CONFLICT DO NOTHING
        `).run(evalSuiteId, evalCaseId);

        caseCount++;
      }

      return { evalSuiteId, caseCount };
    });

    const result = await suiteTx();

    return sendSuccess({
      eval_suite_id: `es${result.evalSuiteId}`,
      case_count: result.caseCount
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
    try {
      const { syncEvalSuitesDevToLocal } = await import('@/lib/ingest-helper');
      await syncEvalSuitesDevToLocal();
    } catch (syncErr) {
      console.error('Failed to lazy sync eval suites:', syncErr);
    }

    const { searchParams } = new URL(req.url);
    const benchmarkSlug = searchParams.get('benchmark_slug');

    let query = `
      SELECT es.id, es.name, es.description, es.created_at, b.slug as benchmark_slug,
             COUNT(esm.eval_case_id) as case_count
      FROM eval_suites es
      JOIN benchmarks b ON es.benchmark_id = b.id
      LEFT JOIN eval_suite_members esm ON es.id = esm.eval_suite_id
      WHERE 1=1
    `;
    const sqlParams: any[] = [];

    if (benchmarkSlug) {
      query += ' AND b.slug = ?';
      sqlParams.push(benchmarkSlug);
    }

    query += ' GROUP BY es.id, b.slug ORDER BY es.id ASC';

    const suites = await db.prepare(query).all(...sqlParams) as any[];

    const formatted = suites.map(s => ({
      id: `es${s.id}`,
      name: s.name,
      benchmark_slug: s.benchmark_slug,
      description: s.description,
      case_count: s.case_count || 0,
      created_at: new Date(s.created_at || Date.now()).toISOString()
    }));

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('List eval suites error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching evaluation suites', null, 500);
  }
}
