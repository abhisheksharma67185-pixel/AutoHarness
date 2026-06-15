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
    const agentName = searchParams.get('agent_name');
    const harnessVersion = searchParams.get('harness_version');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let query = `
      SELECT r.id as id, r.run_label, r.global_score, r.metrics, r.created_at,
             b.name as benchmark, b.slug as benchmark_slug,
             r.agent_name as agent_name,
             hv.name as harness_version
      FROM runs r
      JOIN benchmarks b ON r.benchmark_id = b.id
      LEFT JOIN harness_versions hv ON r.harness_version_id = hv.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (benchmarkSlug) {
      query += ' AND b.slug = ?';
      params.push(benchmarkSlug);
    }
    if (agentName) {
      query += ' AND r.agent_name = ?';
      params.push(agentName);
    }
    if (harnessVersion) {
      query += ' AND hv.name = ?';
      params.push(harnessVersion);
    }

    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const runs = await db.prepare(query).all(...params) as any[];

    const formatted = runs.map(r => {
      let metricsObj = { success_rate: 0, avg_score: 0, num_tasks: 0, num_failures: 0 };
      try {
        const parsed = JSON.parse(r.metrics);
        metricsObj = {
          success_rate: parsed.pass_rate || 0,
          avg_score: parsed.avg_score || 0,
          num_tasks: parsed.total_tasks || 0,
          num_failures: parsed.failed_tasks || 0
        };
      } catch {}

      return {
        id: r.id,
        benchmark_slug: r.benchmark_slug,
        run_label: r.run_label,
        agent_name: r.agent_name,
        harness_version: r.harness_version || 'unknown',
        metrics: metricsObj,
        created_at: new Date(r.created_at || Date.now()).toISOString()
      };
    });

    return sendSuccess(formatted);
  } catch (err: any) {
    return sendError('SERVER_ERROR', err.message || 'Error listing runs', null, 500);
  }
}
