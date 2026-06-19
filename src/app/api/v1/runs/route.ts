import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { searchParams } = new URL(req.url);
    const benchmarkSlug = searchParams.get('benchmark_slug');
    const agentName = searchParams.get('agent_name');
    const harnessVersion = searchParams.get('harness_version');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let query = supabaseServer
      .from('runs')
      .select(`
        id, run_label, global_score, metrics, created_at, agent_name,
        benchmarks!inner ( name, slug ),
        harness_versions ( name )
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (benchmarkSlug) {
      query = query.eq('benchmarks.slug', benchmarkSlug);
    }
    if (agentName) {
      query = query.eq('agent_name', agentName);
    }
    if (harnessVersion) {
      query = query.eq('harness_versions.name', harnessVersion);
    }

    const { data: runs, error } = await query;

    if (error) throw error;

    const formatted = (runs || []).map((r: any) => {
      let metricsObj = { success_rate: 0, avg_score: 0, num_tasks: 0, num_failures: 0 };
      try {
        const parsed = typeof r.metrics === 'string' ? JSON.parse(r.metrics) : (r.metrics || {});
        metricsObj = {
          success_rate: parsed.pass_rate || 0,
          avg_score: parsed.avg_score || 0,
          num_tasks: parsed.total_tasks || 0,
          num_failures: parsed.failed_tasks || 0
        };
      } catch {}

      return {
        id: r.id,
        benchmark_slug: r.benchmarks?.slug,
        run_label: r.run_label,
        agent_name: r.agent_name,
        harness_version: r.harness_versions?.name || 'unknown',
        metrics: metricsObj,
        created_at: new Date(r.created_at || Date.now()).toISOString()
      };
    });

    return sendSuccess(formatted);
  } catch (err: any) {
    return sendError('SERVER_ERROR', err.message || 'Error listing runs', null, 500);
  }
}
