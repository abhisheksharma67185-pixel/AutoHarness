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

    let results = db.prepare(`
      SELECT * FROM eval_results
      WHERE eval_run_id = ?
      ORDER BY id ASC
    `).all(idNum) as any[];

    if (results.length === 0) {
      try {
        const { syncEvalRunsDevToLocal } = await import('@/lib/ingest-helper');
        syncEvalRunsDevToLocal();
        results = db.prepare(`
          SELECT * FROM eval_results
          WHERE eval_run_id = ?
          ORDER BY id ASC
        `).all(idNum) as any[];
      } catch (syncErr) {
        console.error('Failed to lazy sync eval results:', syncErr);
      }
    }

    const formatted = results.map(r => {
      let rawOut = {};
      try {
        rawOut = JSON.parse(r.raw_output || '{}');
      } catch {}

      let judgeMeta = {};
      try {
        judgeMeta = JSON.parse(r.judge_metadata || '{}');
      } catch {}

      return {
        id: `eres${r.id}`,
        eval_run_id: `er${r.eval_run_id}`,
        eval_case_id: `ec${r.eval_case_id}`,
        status: (r.status || 'unknown').toLowerCase(),
        score: r.score,
        raw_output: rawOut,
        judge_metadata: judgeMeta
      };
    });

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('Fetch eval results error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching eval run results', null, 500);
  }
}
