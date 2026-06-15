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
    const cleanId = id.startsWith('er') ? id.slice(2) : id;
    const idNum = parseInt(cleanId, 10);

    if (isNaN(idNum)) {
      return sendError('VALIDATION_ERROR', 'Invalid eval_run_id format', { field: 'eval_run_id' }, 400);
    }

    let er = db.prepare(`
      SELECT er.id, er.eval_suite_id, er.harness_version_id, er.status, er.metrics,
             hv.name as harness_version_name
      FROM eval_runs er
      JOIN harness_versions hv ON er.harness_version_id = hv.id
      WHERE er.id = ?
    `).get(idNum) as any;

    if (!er) {
      try {
        const { syncEvalRunsDevToLocal } = await import('@/lib/ingest-helper');
        syncEvalRunsDevToLocal();
        er = db.prepare(`
          SELECT er.id, er.eval_suite_id, er.harness_version_id, er.status, er.metrics,
                 hv.name as harness_version_name
          FROM eval_runs er
          JOIN harness_versions hv ON er.harness_version_id = hv.id
          WHERE er.id = ?
        `).get(idNum) as any;
      } catch (syncErr) {
        console.error('Failed to lazy sync eval runs:', syncErr);
      }
    }

    if (!er) {
      return sendError('NOT_FOUND', `Eval run not found with ID: ${id}`, { eval_run_id: id }, 404);
    }

    let metricsObj = { pass_rate: 0, avg_score: 0, num_cases: 0 };
    try {
      metricsObj = JSON.parse(er.metrics || '{}');
    } catch {}

    const formatted = {
      id: `er${er.id}`,
      eval_suite_id: `es${er.eval_suite_id}`,
      harness_version_id: `hv-${er.harness_version_name}`,
      status: (er.status || 'unknown').toLowerCase(),
      metrics: metricsObj
    };

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('Fetch eval run error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching eval run details', null, 500);
  }
}
