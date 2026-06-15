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

    let exp = await db.prepare(`
      SELECT e.*, b.slug as benchmark_slug, hv.name as base_harness_version_name
      FROM experiments e
      JOIN benchmarks b ON e.benchmark_id = b.id
      JOIN harness_versions hv ON e.base_harness_version_id = hv.id
      WHERE e.id = ?
    `).get(idNum) as any;

    if (!exp) {
      try {
        const { syncExperimentsDevToLocal } = await import('@/lib/ingest-helper');
        await syncExperimentsDevToLocal();
        exp = await db.prepare(`
          SELECT e.*, b.slug as benchmark_slug, hv.name as base_harness_version_name
          FROM experiments e
          JOIN benchmarks b ON e.benchmark_id = b.id
          JOIN harness_versions hv ON e.base_harness_version_id = hv.id
          WHERE e.id = ?
        `).get(idNum) as any;
      } catch (syncErr) {
        console.error('Failed to lazy sync experiments:', syncErr);
      }
    }

    if (!exp) {
      return sendError('NOT_FOUND', `Experiment not found with ID: ${id}`, { experiment_id: id }, 404);
    }

    // Fetch targets
    const targets = await db.prepare(`
      SELECT target_type, target_id, desired_delta
      FROM experiment_targets
      WHERE experiment_id = ?
    `).all(idNum) as any[];

    const formattedTargets = targets.map(t => {
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
      policyObj = JSON.parse(exp.regression_policy || '{}');
    } catch {}

    const formatted = {
      id: `exp${exp.id}`,
      name: exp.name,
      benchmark_slug: exp.benchmark_slug,
      base_harness_version_id: `hv-${exp.base_harness_version_name}`,
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
