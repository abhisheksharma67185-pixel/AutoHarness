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
    const cleanId = id.startsWith('exp') ? id.slice(3) : id;
    const idNum = parseInt(cleanId, 10);

    if (isNaN(idNum)) {
      return sendError('VALIDATION_ERROR', 'Invalid experiment_id format', { field: 'experiment_id' }, 400);
    }

    const { data: exp, error: expError } = await supabaseServer
      .from('experiments')
      .select(`
        id,
        name,
        target_description,
        regression_policy,
        benchmarks ( slug ),
        harness_versions ( name ),
        experiment_targets (
          target_type,
          target_id,
          desired_delta
        )
      `)
      .eq('id', idNum)
      .maybeSingle();

    if (expError) throw expError;

    if (!exp) {
      return sendError('NOT_FOUND', `Experiment not found with ID: ${id}`, { experiment_id: id }, 404);
    }

    const targets = exp.experiment_targets || [];
    const formattedTargets = targets.map((t: any) => {
      const typeLower = (t.target_type || '').toLowerCase();
      const prefix = typeLower === 'failure_mode' ? 'fm' : (typeLower === 'eval_suite' ? 'es' : '');
      return {
        target_type: typeLower,
        target_id: `${prefix}${t.target_id}`,
        desired_delta: t.desired_delta
      };
    });

    let policyObj = {};
    try {
      policyObj = typeof exp.regression_policy === 'string' ? JSON.parse(exp.regression_policy || '{}') : (exp.regression_policy || {});
    } catch {}

    const bench = exp.benchmarks as any;
    const hv = exp.harness_versions as any;
    const formatted = {
      id: `exp${exp.id}`,
      name: exp.name,
      benchmark_slug: bench?.slug,
      base_harness_version_id: `hv-${hv?.name || 'unknown'}`,
      target_description: exp.target_description,
      targets: formattedTargets,
      regression_policy: policyObj
    };

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('Fetch experiment error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching experiment', null, 500);
  }
}
