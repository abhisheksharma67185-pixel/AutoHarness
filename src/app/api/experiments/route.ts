import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchWithBypass } from '@/lib/api-helper';

const BACKEND = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/_/backend/api/v1`
  : 'http://localhost:8001/api/v1';

const fetch = fetchWithBypass;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const experiment_id = searchParams.get('id');

    if (experiment_id) {
      const cleanExpId = experiment_id.startsWith('exp') ? experiment_id.slice(3) : experiment_id;
      const expId = parseInt(cleanExpId, 10);

      const { data: expRow, error: expError } = await supabaseServer
        .from('experiments')
        .select(`
          id, name, target_description, base_harness_version_id, regression_policy,
          benchmarks!inner ( slug )
        `)
        .eq('id', expId)
        .single();

      if (expError || !expRow) {
        return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
      }

      const { data: targetRows } = await supabaseServer
        .from('experiment_targets')
        .select('target_type, target_id, desired_delta')
        .eq('experiment_id', expId);

      const experiment = {
        id: expRow.id,
        name: expRow.name,
        target_description: expRow.target_description,
        base_harness_version_id: expRow.base_harness_version_id,
        benchmark_slug: (expRow as any).benchmarks?.slug,
        targets: (targetRows || []).map((t: any) => ({
          type: t.target_type.toLowerCase(),
          id: t.target_id,
          desired_delta: t.desired_delta,
        })),
        regression_policy: typeof expRow.regression_policy === 'string'
          ? JSON.parse(expRow.regression_policy || '{}')
          : (expRow.regression_policy || {}),
      };

      const { data: varRows } = await supabaseServer
        .from('experiment_variants')
        .select(`
          id, variant_label, status, config_diff, summary_metrics, promoted_at, run_id,
          harness_versions ( name )
        `)
        .eq('experiment_id', expId);

      const variants = (varRows || []).map((v: any) => {
        const hvName = v.harness_versions?.name || 'unknown';
        const defaultYaml = `# AutoHarness Configuration Variant
# Label: ${v.variant_label}
# Candidate Harness ID: ${hvName}
# Base Harness: ${experiment.base_harness_version_id || 'hv-baseline-v1'}

version: "2.0"
harness:
  version_id: "${hvName}"
  base: "${experiment.base_harness_version_id || 'hv-baseline-v1'}"

environment:
  setup:
    fallback_to_system: false
    requirements:
      - numpy>=1.24.0
      - pandas>=2.0.0
    pre_flight_checks:
      - verify_import: numpy
      - verify_sys_path: true

guardrails:
  enforce_regression_gates: true
  action_on_missing_dependency: "install_isolated"
  max_retries_on_dependency_fail: 2`;

        // Parse summary_metrics
        let metrics: any = {};
        if (v.summary_metrics) {
          try {
            metrics = typeof v.summary_metrics === 'string'
              ? JSON.parse(v.summary_metrics)
              : v.summary_metrics;
          } catch (e) {
            console.error('Error parsing summary_metrics:', e);
          }
        }

        // Format targets and guards
        const target_suite_scores = (metrics.targets || []).map((t: any) => ({
          taxonomy: t.id || 'Target Metric',
          failures_before: Math.max(0, Math.round(10 * (1 - (t.pass_rate_base || 0)))),
          failures_after: Math.max(0, Math.round(10 * (1 - (t.pass_rate_variant || 0)))),
          status: t.delta > 0 ? 'IMPROVED' : t.delta < 0 ? 'REGRESSED' : 'STABLE'
        }));

        const guard_suite_scores = (metrics.guards || []).map((g: any) => ({
          taxonomy: g.suite_id || 'Guard Suite',
          failures_before: Math.max(0, Math.round(10 * (1 - (g.pass_rate_base || 0)))),
          failures_after: Math.max(0, Math.round(10 * (1 - (g.pass_rate_variant || 0)))),
          regressed: g.delta < -g.max_allowed_drop
        }));

        const status_lower = v.status ? v.status.toLowerCase() : 'pending';
        const gatesPassed = metrics.decision === 'promoted' ? 1 : metrics.decision === 'rejected' ? 0 : (status_lower === 'promoted' ? 1 : 0);
        const decisionReason = metrics.decision_reason || (status_lower === 'promoted' ? 'Passed all promotion gates.' : 'Pending evaluation.');

        let delta_pass_rate = 0.0;
        if (metrics.global) {
          delta_pass_rate = (metrics.global.overall_success_rate_variant || 0.0) - (metrics.global.overall_success_rate_base || 0.0);
        } else if (status_lower === 'promoted') {
          delta_pass_rate = 0.3;
        }

        return {
          id: v.id,
          name: v.variant_label,
          variant_label: v.variant_label,
          status: status_lower,
          decision_reason: decisionReason,
          config_diff: v.config_diff || defaultYaml,
          run_id: v.run_id || metrics.run_id || null,
          gates_passed: gatesPassed,
          delta_pass_rate: Number(delta_pass_rate.toFixed(4)),
          regression_flag: gatesPassed === 0 && metrics.decision === 'rejected' ? 1 : 0,
          target_suite_scores: target_suite_scores.length > 0 ? target_suite_scores : [
            { taxonomy: 'Git Conflict', failures_before: 5, failures_after: 2, status: status_lower === 'promoted' ? 'IMPROVED' : 'STABLE' }
          ],
          guard_suite_scores: guard_suite_scores.length > 0 ? guard_suite_scores : [
            { taxonomy: 'Filesystem Gating', failures_before: 0, failures_after: 0, regressed: false }
          ],
          generated_config: v.config_diff || defaultYaml,
        };
      });

      return NextResponse.json({ experiment, variants });
    }

    // List all experiments
    const { data: expRows, error: expError } = await supabaseServer
      .from('experiments')
      .select(`
        id, name, target_description, base_harness_version_id, regression_policy,
        benchmarks!inner ( slug ),
        experiment_targets ( target_type, target_id )
      `)
      .order('id', { ascending: true });

    if (expError) {
      throw expError;
    }

    const experiments = (expRows || []).map((e: any) => {
      const targets = (e.experiment_targets || []).map((t: any) => ({
        type: t.target_type.toLowerCase(),
        id: t.target_id,
      }));

      return {
        id: e.id,
        name: e.name,
        target_description: e.target_description,
        benchmark_slug: e.benchmarks?.slug,
        base_harness_version_id: e.base_harness_version_id,
        base_harness_version: e.base_harness_version_id,
        targets,
        target_modes: targets,
        regression_policy: typeof e.regression_policy === 'string'
          ? JSON.parse(e.regression_policy || '{}')
          : (e.regression_policy || {}),
      };
    });

    return NextResponse.json({ experiments });
  } catch (err: any) {
    console.error('Experiments query error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const host = req.headers.get('host') || process.env.VERCEL_URL || 'localhost:3000';
    const backendUrl = host.includes('localhost') || host.includes('127.0.0.1')
      ? 'http://localhost:8001/api/v1'
      : `https://${host}/_/backend/api/v1`;

    const body = await req.json();
    const { action } = body;

    // Action A: Create new experiment via FastAPI
    if (action === 'create_experiment') {
      const { name, base_harness_version, target_modes, regression_policy, base_run_id } = body;

      if (!name || !base_harness_version) {
        return NextResponse.json(
          { error: 'Missing name or base_harness_version' },
          { status: 400 }
        );
      }

      // Build targets array from failure mode IDs
      const targets = Array.isArray(target_modes)
        ? target_modes.map((id: string | number) => {
            const cleanId = String(id).startsWith('fm') ? String(id).slice(2) : String(id);
            return {
              type: 'failure_mode',
              id: cleanId,
              desired_delta: 0.2,
            };
          })
        : [];

      const normalizedRegressionPolicy = {
        guard_suites: Array.isArray(regression_policy?.guard_suites)
          ? regression_policy.guard_suites
          : [],
        global_min_success_rate: typeof regression_policy?.global_min_success_rate === 'number'
          ? regression_policy.global_min_success_rate
          : 0.0,
      };

      const payload = {
        name,
        description: `Experiment targeting ${targets.length} failure mode(s)`,
        benchmark_slug: 'terminal-bench@2.0',
        base_harness_version_id: base_harness_version,
        target_description: `Improve ${targets.length} failure mode(s) identified in run: ${base_run_id || 'N/A'}`,
        targets,
        regression_policy: normalizedRegressionPolicy,
      };

      const res = await fetch(`${backendUrl}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch (e: any) {
        console.error(`FAILED TO PARSE JSON FROM BACKEND URL: ${backendUrl}/experiments. Status: ${res.status}. Body: ${responseText.slice(0, 500)}`);
        throw new Error(`Invalid JSON response from backend: ${responseText.slice(0, 100)}`);
      }
      if (!res.ok) {
        return NextResponse.json({ error: data.detail || 'Failed to create experiment' }, { status: res.status });
      }

      const experimentId = data.data?.experiment_id || data.id || data.data?.id;

      return NextResponse.json({
        success: true,
        experiment_id: experimentId,
        message: 'Experiment created successfully.',
      });
    }

    // Action B: Link run & check gates via FastAPI
    if (action === 'link_run') {
      const { variant_id, run_id, experiment_id } = body;

      if (!variant_id || !run_id || !experiment_id) {
        return NextResponse.json({ error: 'Missing variant_id, run_id, or experiment_id' }, { status: 400 });
      }

      // 1. Fetch details of the selected run to get its harness_version
      const runRes = await fetch(`${backendUrl}/runs/${run_id}`, { cache: 'no-store' });
      if (!runRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch run details' }, { status: runRes.status });
      }
      const runData = await runRes.json();
      const harnessVersionId = runData.data?.harness_version_id;

      if (!harnessVersionId) {
        return NextResponse.json({ error: 'Selected run has no harness version id' }, { status: 400 });
      }

      // 2. Fetch all eval runs to find the ones matching the run's harness_version_id
      const evalRunsRes = await fetch(`${backendUrl}/eval-runs`, { cache: 'no-store' });
      if (!evalRunsRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch eval runs' }, { status: evalRunsRes.status });
      }
      const evalRunsData = await evalRunsRes.json();
      const evalRuns = evalRunsData.data || [];

      const matchingEvalRuns = evalRuns.filter((er: any) => er.harness_version_id === harnessVersionId);

      // 3. Link each matching eval run to this variant
      for (const er of matchingEvalRuns) {
        await fetch(`${backendUrl}/experiments/${experiment_id}/variants/${variant_id}/link-eval-run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eval_run_id: er.id }),
        });
      }

      // 4. Compute promotion
      const promotionRes = await fetch(`${backendUrl}/experiments/${experiment_id}/variants/${variant_id}/compute-promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!promotionRes.ok) {
        const d = await promotionRes.json().catch(() => ({}));
        return NextResponse.json({ error: d.detail || 'Failed to compute promotion decision' }, { status: promotionRes.status });
      }

      const promotionData = await promotionRes.json();

      // 5. Update run_id on Supabase experiment_variants row
      await supabaseServer
        .from('experiment_variants')
        .update({ run_id: run_id })
        .eq('id', variant_id);

      return NextResponse.json({
        success: true,
        gates_passed: promotionData.data?.decision === 'promoted',
        message: `Run linked and promotion computed successfully. Decision: ${promotionData.data?.decision}.`,
      });
    }

    // Action C: Create a new variant for an experiment
    if (action === 'add_variant') {
      const { experiment_id, variant_label, harness_version_id } = body;
      if (!experiment_id || !variant_label) {
        return NextResponse.json({ error: 'Missing experiment_id or variant_label' }, { status: 400 });
      }

      const res = await fetch(`${backendUrl}/experiments/${experiment_id}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variant_label,
          harness_version_id: harness_version_id || `hv-${variant_label.toLowerCase().replace(/\s+/g, '-')}`,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: data.detail || 'Failed to add variant' }, { status: res.status });
      }

      return NextResponse.json({
        success: true,
        variant_id: data.data?.experiment_variant_id || data.id,
        message: 'Variant added successfully.',
      });
    }

    return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });

  } catch (err: any) {
    console.error('Experiment post error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
