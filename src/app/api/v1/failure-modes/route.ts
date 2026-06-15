import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { searchParams } = new URL(req.url);
    const benchmarkSlug = searchParams.get('benchmark_slug');
    const runId = searchParams.get('run_id');

    if (!benchmarkSlug) {
      return sendError('VALIDATION_ERROR', 'Missing required query parameter: benchmark_slug', { field: 'benchmark_slug' }, 400);
    }

    // Resolve benchmark
    const bench = db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(benchmarkSlug) as any;
    if (!bench) {
      return sendSuccess([]); // Return empty list if benchmark slug doesn't exist
    }

    let query = `
      SELECT fm.id, fm.name, fm.description, fm.taxonomy_primary, fm.created_at,
             COUNT(fmm.failure_label_id) as failure_count,
             AVG(rt.score) as avg_score,
             GROUP_CONCAT(DISTINCT hv.name) as harness_versions
      FROM failure_modes fm
      LEFT JOIN failure_mode_members fmm ON fm.id = fmm.failure_mode_id
      LEFT JOIN failure_labels fl ON fmm.failure_label_id = fl.id
      LEFT JOIN run_tasks rt ON fl.run_task_id = rt.id
      LEFT JOIN runs r ON rt.run_id = r.id
      LEFT JOIN harness_versions hv ON r.harness_version_id = hv.id
      WHERE fm.benchmark_id = ?
    `;
    const sqlParams: any[] = [bench.id];

    if (runId) {
      query += ' AND r.id = ?';
      sqlParams.push(runId);
    }

    query += ' GROUP BY fm.id ORDER BY failure_count DESC';

    const modes = db.prepare(query).all(...sqlParams) as any[];

    const formatted = modes.map(m => {
      let versions: string[] = [];
      if (m.harness_versions) {
        versions = m.harness_versions.split(',');
      }

      return {
        id: `fm${m.id}`,
        benchmark_slug: benchmarkSlug,
        name: m.name,
        description: m.description,
        taxonomy_primary: (m.taxonomy_primary || 'other').toLowerCase(),
        failure_count: m.failure_count || 0,
        avg_score: m.avg_score !== null ? m.avg_score : 0.0,
        affected_harness_versions: versions,
        created_at: new Date(m.created_at || Date.now()).toISOString()
      };
    });

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('List failure modes error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching failure modes', null, 500);
  }
}
