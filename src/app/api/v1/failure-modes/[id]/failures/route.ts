import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
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

    const { data: members, error } = await supabaseServer
      .from('failure_mode_members')
      .select(`
        distance,
        failure_labels (
          id,
          run_task_id,
          diagnosis_text,
          taxonomy_primary,
          run_tasks (
            score,
            run_id,
            benchmark_tasks (
              title
            )
          )
        )
      `)
      .eq('failure_mode_id', idNum);

    if (error) throw error;

    const formatted = (members || []).map((m: any) => {
      const fl = Array.isArray(m.failure_labels) ? m.failure_labels[0] : m.failure_labels;
      const rt = Array.isArray(fl?.run_tasks) ? fl.run_tasks[0] : fl?.run_tasks;
      const bt = Array.isArray(rt?.benchmark_tasks) ? rt.benchmark_tasks[0] : rt?.benchmark_tasks;

      return {
        failure_label_id: fl ? `fl${fl.id}` : null,
        run_task_id: fl ? `rt${fl.run_task_id}` : null,
        run_id: rt?.run_id || null,
        task_title: bt?.title || null,
        diagnosis_text: fl?.diagnosis_text || null,
        taxonomy_primary: fl?.taxonomy_primary ? fl.taxonomy_primary.toLowerCase() : 'other',
        score: rt?.score !== undefined ? rt.score : 0.0,
        distance_from_centroid: m.distance !== null && m.distance !== undefined ? m.distance : 0.0
      };
    });

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('List failure mode members error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching failure mode members', null, 500);
  }
}
