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
    
    const { data: run, error: runError } = await supabaseServer
      .from('runs')
      .select(`
        id,
        run_label,
        global_score,
        metrics,
        created_at,
        raw_artifact_uri,
        agent_name,
        benchmarks!inner ( slug ),
        harness_versions ( name )
      `)
      .eq('id', id)
      .maybeSingle();

    if (runError) throw runError;

    if (!run) {
      return sendError('NOT_FOUND', `Run not found with ID: ${id}`, { run_id: id }, 404);
    }

    let metricsObj = { success_rate: 0, avg_score: 0, num_tasks: 0, num_failures: 0 };
    try {
      const parsed = typeof run.metrics === 'string' ? JSON.parse(run.metrics) : (run.metrics || {});
      metricsObj = {
        success_rate: parsed.pass_rate ?? 0,
        avg_score: parsed.avg_score ?? 0,
        num_tasks: parsed.total_tasks ?? 0,
        num_failures: parsed.failed_tasks ?? 0
      };
    } catch {}

    const bench = run.benchmarks as any;
    const hv = run.harness_versions as any;
    const formatted = {
      id: run.id,
      benchmark_slug: bench?.slug,
      run_label: run.run_label,
      agent_name: run.agent_name,
      harness_version: hv?.name || 'unknown',
      metrics: metricsObj,
      created_at: new Date(run.created_at || Date.now()).toISOString(),
      raw_artifact_uri: run.raw_artifact_uri
    };

    return sendSuccess(formatted);
  } catch (err: any) {
    return sendError('SERVER_ERROR', err.message || 'Error fetching run details', null, 500);
  }
}
