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
    const cleanId = id.startsWith('rt') ? id.slice(2) : id;
    const idNum = parseInt(cleanId, 10);

    if (isNaN(idNum)) {
      return sendError('VALIDATION_ERROR', 'Invalid run_task_id format', { field: 'run_task_id' }, 400);
    }

    const { data: steps, error } = await supabaseServer
      .from('trace_steps')
      .select('*')
      .eq('run_task_id', idNum)
      .order('step_index', { ascending: true });

    if (error) throw error;

    const formattedSteps = (steps || []).map(s => {
      let metaObj = {};
      try {
        metaObj = typeof s.metadata === 'string' ? JSON.parse(s.metadata || '{}') : (s.metadata || {});
      } catch {}

      return {
        step_index: s.step_index,
        step_type: (s.step_type || 'log').toLowerCase(),
        content: s.content,
        metadata: metaObj
      };
    });

    return sendSuccess({
      run_task_id: id,
      steps: formattedSteps
    });
  } catch (err: any) {
    return sendError('SERVER_ERROR', err.message || 'Error fetching task trace', null, 500);
  }
}
