import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const body = await req.json();
    const { name, benchmark_slug, base_harness_version_id, target_description, targets, regression_policy } = body;

    if (!name) {
      return sendError('VALIDATION_ERROR', 'Missing field name', { field: 'name' }, 400);
    }
    if (!benchmark_slug) {
      return sendError('VALIDATION_ERROR', 'Missing field benchmark_slug', { field: 'benchmark_slug' }, 400);
    }
    if (!base_harness_version_id) {
      return sendError('VALIDATION_ERROR', 'Missing field base_harness_version_id', { field: 'base_harness_version_id' }, 400);
    }

    // Resolve benchmark
    const bench = await db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(benchmark_slug) as any;
    if (!bench) {
      return sendError('NOT_FOUND', `Benchmark not found with slug: ${benchmark_slug}`, { benchmark_slug }, 404);
    }

    // Clean harness version ID
    let harnessName = base_harness_version_id;
    if (harnessName.startsWith('hv-')) {
      harnessName = harnessName.slice(3);
    }
    let hv = await db.prepare('SELECT id, name FROM harness_versions WHERE name = ?').get(harnessName) as any;
    if (!hv) {
      const hvIdNum = parseInt(harnessName, 10);
      if (!isNaN(hvIdNum)) {
        hv = await db.prepare('SELECT id, name FROM harness_versions WHERE id = ?').get(hvIdNum) as any;
      }
    }

    if (!hv) {
      return sendError('NOT_FOUND', `Base harness version not found: ${base_harness_version_id}`, { base_harness_version_id }, 404);
    }

    const expTx = db.transaction(async () => {
      // 1. Insert Experiment
      const expResult = await db.prepare(`
        INSERT INTO experiments (name, benchmark_id, base_harness_version_id, target_description, config_template, regression_policy)
        VALUES (?, ?, ?, ?, '{}', ?)
        RETURNING id
      `).run(
        name,
        bench.id,
        hv.id,
        target_description || '',
        JSON.stringify(regression_policy || {})
      );
      const experimentId = expResult.lastInsertRowid;

      // 2. Insert Targets
      if (targets && Array.isArray(targets)) {
        for (const t of targets) {
          const typeStr = (t.target_type || '').toUpperCase();
          const cleanTargetId = t.target_id.startsWith('fm') ? t.target_id.slice(2) : (t.target_id.startsWith('es') ? t.target_id.slice(2) : t.target_id);
          const targetIdNum = parseInt(cleanTargetId, 10);

          if (isNaN(targetIdNum)) continue;

          await db.prepare(`
            INSERT INTO experiment_targets (experiment_id, target_type, target_id, desired_delta)
            VALUES (?, ?, ?, ?)
          `).run(experimentId, typeStr, targetIdNum, t.desired_delta);
        }
      }

      return experimentId;
    });

    const experimentId = await expTx();

    return sendSuccess({
      experiment_id: `exp${experimentId}`
    }, 201);

  } catch (err: any) {
    console.error('Create experiment error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error creating experiment', null, 500);
  }
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    try {
      const { syncExperimentsDevToLocal } = await import('@/lib/ingest-helper');
      await syncExperimentsDevToLocal();
    } catch (syncErr) {
      console.error('Failed to lazy sync experiments on list:', syncErr);
    }

    const { searchParams } = new URL(req.url);
    const benchmarkSlug = searchParams.get('benchmark_slug');

    let query = `
      SELECT e.id, e.name, e.target_description, e.created_at, b.slug as benchmark_slug,
             hv.name as base_harness_version
      FROM experiments e
      JOIN benchmarks b ON e.benchmark_id = b.id
      JOIN harness_versions hv ON e.base_harness_version_id = hv.id
      WHERE 1=1
    `;
    const sqlParams: any[] = [];

    if (benchmarkSlug) {
      query += ' AND b.slug = ?';
      sqlParams.push(benchmarkSlug);
    }

    query += ' ORDER BY e.id ASC';

    const experiments = await db.prepare(query).all(...sqlParams) as any[];

    const formatted = [];
    for (const e of experiments) {
      const targets = await db.prepare(`
        SELECT target_type, target_id, desired_delta
        FROM experiment_targets
        WHERE experiment_id = ?
      `).all(e.id) as any[];

      const formattedTargets = targets.map(t => {
        const typeLower = (t.target_type || '').toLowerCase();
        const prefix = typeLower === 'failure_mode' ? 'fm' : (typeLower === 'eval_suite' ? 'es' : '');
        return {
          target_type: typeLower,
          target_id: `${prefix}${t.target_id}`,
          desired_delta: t.desired_delta
        };
      });

      formatted.push({
        id: `exp${e.id}`,
        name: e.name,
        benchmark_slug: e.benchmark_slug,
        base_harness_version_id: `hv-${e.base_harness_version}`,
        target_description: e.target_description || '',
        targets: formattedTargets,
        created_at: new Date(e.created_at || Date.now()).toISOString()
      });
    }

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('List experiments error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching experiments', null, 500);
  }
}
