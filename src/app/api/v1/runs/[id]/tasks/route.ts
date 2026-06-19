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
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const taxonomyParam = searchParams.get('taxonomy_primary');

    let query = supabaseServer
      .from('run_tasks')
      .select(`
        id,
        status,
        score,
        benchmark_tasks!inner ( id, title ),
        failure_labels ( id, taxonomy_primary, diagnosis_text )
      `)
      .eq('run_id', id);

    if (statusParam) {
      query = query.eq('status', statusParam.toUpperCase());
    }

    query = query.order('id', { ascending: true });

    const { data: tasks, error: tasksError } = await query;
    if (tasksError) throw tasksError;

    let filteredTasks = tasks || [];
    if (taxonomyParam) {
      filteredTasks = filteredTasks.filter((t: any) => {
        const fl = Array.isArray(t.failure_labels) ? t.failure_labels[0] : t.failure_labels;
        return fl?.taxonomy_primary?.toUpperCase() === taxonomyParam.toUpperCase();
      });
    }

    const formatted = filteredTasks.map((t: any) => {
      const fl = Array.isArray(t.failure_labels) ? t.failure_labels[0] : t.failure_labels;
      const isFailure = t.status !== 'PASS';
      return {
        id: `rt${t.id}`,
        benchmark_task_id: `bt${t.benchmark_tasks?.id}`,
        task_title: t.benchmark_tasks?.title,
        status: (t.status || 'unknown').toLowerCase(),
        score: t.score,
        is_failure: isFailure,
        taxonomy_primary: fl?.taxonomy_primary ? fl.taxonomy_primary.toLowerCase() : null,
        diagnosis_text: fl?.diagnosis_text || null
      };
    });

    return sendSuccess(formatted);
  } catch (err: any) {
    return sendError('SERVER_ERROR', err.message || 'Error listing run tasks', null, 500);
  }
}
