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
      .select('id')
      .eq('id', idNum)
      .maybeSingle();

    if (expError) throw expError;
    if (!exp) {
      return sendError('NOT_FOUND', `Experiment not found with ID: ${id}`, { experiment_id: id }, 404);
    }

    const { data: variants, error: varError } = await supabaseServer
      .from('experiment_variants')
      .select(`
        id,
        variant_label,
        config_diff,
        exported_config_uri,
        status,
        harness_version_id,
        harness_versions ( name ),
        experiment_variant_eval_summaries (
          delta_pass_rate,
          regression_flag
        )
      `)
      .eq('experiment_id', idNum);

    if (varError) throw varError;

    const formattedVariants = [];
    for (const v of (variants || [])) {
      // Fetch associated run metrics for this harness_version_id
      const { data: run, error: runError } = await supabaseServer
        .from('runs')
        .select('metrics')
        .eq('harness_version_id', v.harness_version_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let metrics = null;
      const runMetrics = run?.metrics;
      if (runMetrics) {
        try {
          const m = typeof runMetrics === 'string' ? JSON.parse(runMetrics) : (runMetrics || {});
          metrics = {
            success_rate: m.pass_rate !== undefined ? m.pass_rate : 0.0,
            avg_score: m.avg_score !== undefined ? m.avg_score : 0.0,
            num_tasks: m.total_tasks !== undefined ? m.total_tasks : 0
          };
        } catch {}
      }

      let targetSuiteDelta = 0.0;
      const regressionFlags: string[] = [];
      let gatePassed: boolean | null = null;

      if (v.status === 'EVALUATED' || v.status === 'PROMOTED' || v.status === 'REJECTED') {
        const summaries = v.experiment_variant_eval_summaries || [];
        if (summaries.length > 0) {
          targetSuiteDelta = summaries[0].delta_pass_rate || 0.0;
          const hasRegression = summaries.some((s: any) => s.regression_flag === 1);
          if (hasRegression) {
            regressionFlags.push('guard_suite_regression');
          }
          gatePassed = !hasRegression;
        } else {
          gatePassed = v.status !== 'REJECTED';
        }
      }

      let diffObj = {};
      try {
        diffObj = typeof v.config_diff === 'string' ? JSON.parse(v.config_diff || '{}') : (v.config_diff || {});
      } catch {}

      formattedVariants.push({
        id: `ev${v.id}`,
        experiment_variant_id: `ev${v.id}`,
        variant_label: v.variant_label,
        config_diff: diffObj,
        exported_config_uri: v.exported_config_uri,
        status: v.status.toLowerCase(),
        metrics,
        target_suite_delta: targetSuiteDelta,
        regression_flags: regressionFlags,
        gate_passed: gatePassed
      });
    }

    return sendSuccess(formattedVariants);

  } catch (err: any) {
    console.error('Fetch experiment variants error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching experiment variants', null, 500);
  }
}
