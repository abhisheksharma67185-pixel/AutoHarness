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

    const { data: results, error: resultsError } = await supabaseServer
      .from('eval_results')
      .select('*')
      .eq('eval_run_id', idNum);

    if (resultsError) throw resultsError;

    const formatted = (results || []).map((r: any) => {
      let rawOut = {};
      try {
        rawOut = typeof r.raw_output === 'string' ? JSON.parse(r.raw_output || '{}') : (r.raw_output || {});
      } catch {}

      let judgeMeta = {};
      try {
        judgeMeta = typeof r.judge_metadata === 'string' ? JSON.parse(r.judge_metadata || '{}') : (r.judge_metadata || {});
      } catch {}

      return {
        id: r.id ? `eres${r.id}` : `eres${r.eval_run_id}_${r.eval_case_id}`,
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
