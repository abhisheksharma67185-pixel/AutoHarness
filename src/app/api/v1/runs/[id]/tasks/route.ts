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

    // Check if run exists, if not sync it from dev.db
    const runExists = db.prepare('SELECT id FROM runs WHERE id = ?').get(id);
    if (!runExists) {
      const { syncRunDevToLocal } = await import('@/lib/ingest-helper');
      syncRunDevToLocal(id);
    }

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const taxonomyParam = searchParams.get('taxonomy_primary');

    let query = `
      SELECT rt.id, rt.benchmark_task_id, rt.status, rt.score,
             bt.title as task_title,
             fl.taxonomy_primary as taxonomy_primary,
             fl.diagnosis_text as diagnosis_text
      FROM run_tasks rt
      JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
      LEFT JOIN failure_labels fl ON rt.id = fl.run_task_id
      WHERE rt.run_id = ?
    `;
    const sqlParams: any[] = [id];

    if (statusParam) {
      query += ' AND rt.status = ?';
      sqlParams.push(statusParam.toUpperCase());
    }
    if (taxonomyParam) {
      query += ' AND fl.taxonomy_primary = ?';
      sqlParams.push(taxonomyParam.toUpperCase());
    }

    query += ' ORDER BY rt.id ASC';

    const tasks = db.prepare(query).all(...sqlParams) as any[];

    const formatted = tasks.map(t => {
      const isFailure = t.status !== 'PASS';
      return {
        id: `rt${t.id}`,
        benchmark_task_id: `bt${t.benchmark_task_id}`,
        task_title: t.task_title,
        status: (t.status || 'unknown').toLowerCase(),
        score: t.score,
        is_failure: isFailure,
        taxonomy_primary: t.taxonomy_primary ? t.taxonomy_primary.toLowerCase() : null,
        diagnosis_text: t.diagnosis_text || null
      };
    });

    return sendSuccess(formatted);
  } catch (err: any) {
    return sendError('SERVER_ERROR', err.message || 'Error listing run tasks', null, 500);
  }
}
