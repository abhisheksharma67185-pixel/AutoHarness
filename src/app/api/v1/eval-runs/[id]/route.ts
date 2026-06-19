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
    const cleanId = id.startsWith('er') ? id.slice(2) : id;
    const idNum = parseInt(cleanId, 10);

    if (isNaN(idNum)) {
      return sendError('VALIDATION_ERROR', 'Invalid eval_run_id format', { field: 'eval_run_id' }, 400);
    }

    const { data: er, error: erError } = await supabaseServer
      .from('eval_runs')
      .select(`
        id,
        eval_suite_id,
        status,
        metrics,
        harness_versions ( name )
      `)
      .eq('id', idNum)
      .maybeSingle();

    if (erError) throw erError;

    if (!er) {
      return sendError('NOT_FOUND', `Eval run not found with ID: ${id}`, { eval_run_id: id }, 404);
    }

    let metricsObj = { pass_rate: 0, avg_score: 0, num_cases: 0 };
    try {
      metricsObj = typeof er.metrics === 'string' ? JSON.parse(er.metrics || '{}') : (er.metrics || {});
    } catch {}

    const hv = er.harness_versions as any;
    const formatted = {
      id: `er${er.id}`,
      eval_suite_id: `es${er.eval_suite_id}`,
      harness_version_id: `hv-${hv?.name || 'unknown'}`,
      status: (er.status || 'unknown').toLowerCase(),
      metrics: metricsObj
    };

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('Fetch eval run error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching eval run details', null, 500);
  }
}
