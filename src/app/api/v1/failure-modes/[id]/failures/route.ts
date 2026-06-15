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
    const cleanId = id.startsWith('fm') ? id.slice(2) : id;
    const idNum = parseInt(cleanId, 10);

    if (isNaN(idNum)) {
      return sendError('VALIDATION_ERROR', 'Invalid failure_mode_id format', { field: 'failure_mode_id' }, 400);
    }

    const failures = db.prepare(`
      SELECT fl.id as failure_label_id, fl.run_task_id, rt.run_id, fl.diagnosis_text, fl.taxonomy_primary, rt.score,
             bt.title as task_title, fmm.distance as distance_from_centroid
      FROM failure_mode_members fmm
      JOIN failure_labels fl ON fmm.failure_label_id = fl.id
      JOIN run_tasks rt ON fl.run_task_id = rt.id
      JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id
      WHERE fmm.failure_mode_id = ?
      ORDER BY fl.id ASC
    `).all(idNum) as any[];

    const formatted = failures.map(f => ({
      failure_label_id: `fl${f.failure_label_id}`,
      run_task_id: `rt${f.run_task_id}`,
      run_id: f.run_id,
      task_title: f.task_title,
      diagnosis_text: f.diagnosis_text,
      taxonomy_primary: (f.taxonomy_primary || 'other').toLowerCase(),
      score: f.score,
      distance_from_centroid: f.distance_from_centroid !== null && f.distance_from_centroid !== undefined ? f.distance_from_centroid : 0.0
    }));

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('List failure mode members error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching failure mode members', null, 500);
  }
}
