import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';

interface Params {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { id } = await params;
    let run = await db.prepare(`
      SELECT r.id, r.run_label, r.global_score, r.metrics, r.created_at, r.raw_artifact_uri,
             b.slug as benchmark_slug,
             r.agent_name as agent_name,
             hv.name as harness_version
      FROM runs r
      JOIN benchmarks b ON r.benchmark_id = b.id
      LEFT JOIN harness_versions hv ON r.harness_version_id = hv.id
      WHERE r.id = ?
    `).get(id) as any;

    if (!run) {
      const { syncRunDevToLocal } = await import('@/lib/ingest-helper');
      const synced = await syncRunDevToLocal(id);
      if (synced) {
        run = await db.prepare(`
          SELECT r.id, r.run_label, r.global_score, r.metrics, r.created_at, r.raw_artifact_uri,
                 b.slug as benchmark_slug,
                 r.agent_name as agent_name,
                 hv.name as harness_version
          FROM runs r
          JOIN benchmarks b ON r.benchmark_id = b.id
          LEFT JOIN harness_versions hv ON r.harness_version_id = hv.id
          WHERE r.id = ?
        `).get(id) as any;
      }
    }

    if (!run) {
      return sendError('NOT_FOUND', `Run not found with ID: ${id}`, { run_id: id }, 404);
    }

    let metricsObj = { success_rate: 0, avg_score: 0, num_tasks: 0, num_failures: 0 };
    try {
      const parsed = JSON.parse(run.metrics);
      metricsObj = {
        success_rate: parsed.pass_rate || 0,
        avg_score: parsed.avg_score || 0,
        num_tasks: parsed.total_tasks || 0,
        num_failures: parsed.failed_tasks || 0
      };
    } catch {}

    const formatted = {
      id: run.id,
      benchmark_slug: run.benchmark_slug,
      run_label: run.run_label,
      agent_name: run.agent_name,
      harness_version: run.harness_version || 'unknown',
      metrics: metricsObj,
      created_at: new Date(run.created_at || Date.now()).toISOString(),
      raw_artifact_uri: run.raw_artifact_uri
    };

    return sendSuccess(formatted);
  } catch (err: any) {
    return sendError('SERVER_ERROR', err.message || 'Error fetching run details', null, 500);
  }
}
