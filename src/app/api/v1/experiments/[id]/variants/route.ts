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
    const cleanId = id.startsWith('exp') ? id.slice(3) : id;
    const idNum = parseInt(cleanId, 10);

    if (isNaN(idNum)) {
      return sendError('VALIDATION_ERROR', 'Invalid experiment_id format', { field: 'experiment_id' }, 400);
    }

    let exp = await db.prepare('SELECT id FROM experiments WHERE id = ?').get(idNum) as any;
    if (!exp) {
      try {
        const { syncExperimentsDevToLocal } = await import('@/lib/ingest-helper');
        await syncExperimentsDevToLocal();
        exp = await db.prepare('SELECT id FROM experiments WHERE id = ?').get(idNum) as any;
      } catch (syncErr) {
        console.error('Failed to lazy sync experiments in variants route:', syncErr);
      }
    }
    if (!exp) {
      return sendError('NOT_FOUND', `Experiment not found with ID: ${id}`, { experiment_id: id }, 404);
    }

    const variants = await db.prepare(`
      SELECT ev.*, hv.name as harness_version_name, r.id as run_id, r.metrics as run_metrics
      FROM experiment_variants ev
      JOIN harness_versions hv ON ev.harness_version_id = hv.id
      LEFT JOIN runs r ON ev.harness_version_id = r.harness_version_id
      WHERE ev.experiment_id = ?
    `).all(idNum) as any[];

    const formattedVariants = [];
    for (const v of variants) {
      let metrics = null;
      if (v.run_metrics) {
        try {
          const m = JSON.parse(v.run_metrics);
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
        const summaries = await db.prepare('SELECT delta_pass_rate, regression_flag FROM experiment_variant_eval_summaries WHERE experiment_variant_id = ?').all(v.id) as any[];
        if (summaries.length > 0) {
          targetSuiteDelta = summaries[0].delta_pass_rate || 0.0;
          const hasRegression = summaries.some(s => s.regression_flag === 1);
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
        diffObj = JSON.parse(v.config_diff || '{}');
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
