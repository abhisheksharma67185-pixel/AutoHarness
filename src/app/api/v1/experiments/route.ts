import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
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
    const { data: bench, error: benchError } = await supabaseServer
      .from('benchmarks')
      .select('id')
      .eq('slug', benchmark_slug)
      .maybeSingle();

    if (benchError) throw benchError;
    if (!bench) {
      return sendError('NOT_FOUND', `Benchmark not found with slug: ${benchmark_slug}`, { benchmark_slug }, 404);
    }

    // Clean harness version ID
    let harnessName = base_harness_version_id;
    if (harnessName.startsWith('hv-')) {
      harnessName = harnessName.slice(3);
    }

    let hv: any = null;
    const { data: hvByName, error: hvNameError } = await supabaseServer
      .from('harness_versions')
      .select('id, name')
      .eq('name', harnessName)
      .maybeSingle();

    if (hvNameError) throw hvNameError;

    if (hvByName) {
      hv = hvByName;
    } else {
      const hvIdNum = parseInt(harnessName, 10);
      if (!isNaN(hvIdNum)) {
        const { data: hvById, error: hvIdError } = await supabaseServer
          .from('harness_versions')
          .select('id, name')
          .eq('id', hvIdNum)
          .maybeSingle();
        if (hvIdError) throw hvIdError;
        if (hvById) hv = hvById;
      }
    }

    if (!hv) {
      return sendError('NOT_FOUND', `Base harness version not found: ${base_harness_version_id}`, { base_harness_version_id }, 404);
    }

    // 1. Insert Experiment
    const { data: newExp, error: expError } = await supabaseServer
      .from('experiments')
      .insert({
        name,
        benchmark_id: bench.id,
        base_harness_version_id: hv.id,
        target_description: target_description || '',
        config_template: '{}',
        regression_policy: JSON.stringify(regression_policy || {})
      })
      .select('id')
      .single();

    if (expError || !newExp) throw expError || new Error('Failed to create experiment');
    const experimentId = newExp.id;

    // 2. Insert Targets
    if (targets && Array.isArray(targets)) {
      const targetsData = [];
      for (const t of targets) {
        const typeStr = (t.target_type || '').toUpperCase();
        const cleanTargetId = t.target_id.startsWith('fm') ? t.target_id.slice(2) : (t.target_id.startsWith('es') ? t.target_id.slice(2) : t.target_id);
        const targetIdNum = parseInt(cleanTargetId, 10);

        if (isNaN(targetIdNum)) continue;

        targetsData.push({
          experiment_id: experimentId,
          target_type: typeStr,
          target_id: targetIdNum,
          desired_delta: t.desired_delta
        });
      }

      if (targetsData.length > 0) {
        const { error: targetError } = await supabaseServer
          .from('experiment_targets')
          .insert(targetsData);
        if (targetError) throw targetError;
      }
    }

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
    const { searchParams } = new URL(req.url);
    const benchmarkSlug = searchParams.get('benchmark_slug');

    let query = supabaseServer
      .from('experiments')
      .select(`
        id,
        name,
        target_description,
        created_at,
        benchmarks!inner ( slug ),
        harness_versions ( name ),
        experiment_targets (
          target_type,
          target_id,
          desired_delta
        )
      `);

    if (benchmarkSlug) {
      query = query.eq('benchmarks.slug', benchmarkSlug);
    }

    query = query.order('id', { ascending: true });

    const { data: experiments, error } = await query;
    if (error) throw error;

    const formatted = (experiments || []).map((e: any) => {
      const targets = e.experiment_targets || [];
      const formattedTargets = targets.map((t: any) => {
        const typeLower = (t.target_type || '').toLowerCase();
        const prefix = typeLower === 'failure_mode' ? 'fm' : (typeLower === 'eval_suite' ? 'es' : '');
        return {
          target_type: typeLower,
          target_id: `${prefix}${t.target_id}`,
          desired_delta: t.desired_delta
        };
      });

      return {
        id: `exp${e.id}`,
        name: e.name,
        benchmark_slug: e.benchmarks?.slug,
        base_harness_version_id: `hv-${e.harness_versions?.name || 'unknown'}`,
        target_description: e.target_description || '',
        targets: formattedTargets,
        created_at: new Date(e.created_at || Date.now()).toISOString()
      };
    });

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('List experiments error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching experiments', null, 500);
  }
}
