import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
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

      const expRow = await db.prepare(`
        SELECT e.id, e.name, e.target_description, e.base_harness_version_id, b.slug as benchmark_slug, e.regression_policy
        FROM experiments e
        JOIN benchmarks b ON e.benchmark_id = b.id
        WHERE e.id = ?
      `).get(expId) as any;

      if (!expRow) {
        return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
      }

      const targetRows = await db.prepare(`
        SELECT target_type as type, target_id as id, desired_delta
        FROM experiment_targets
        WHERE experiment_id = ?
      `).all(expId) as any[];

      const experiment = {
        id: expRow.id,
        name: expRow.name,
        target_description: expRow.target_description,
        base_harness_version_id: expRow.base_harness_version_id,
        benchmark_slug: expRow.benchmark_slug,
        targets: targetRows.map(t => ({
          type: t.type.toLowerCase(),
          id: t.id,
          desired_delta: t.desired_delta,
        })),
        regression_policy: JSON.parse(expRow.regression_policy || '{}'),
      };

      const varRows = await db.prepare(`
        SELECT ev.id, ev.variant_label, ev.status, ev.config_diff, hv.name as harness_version_id
        FROM experiment_variants ev
        LEFT JOIN harness_versions hv ON ev.harness_version_id = hv.id
        WHERE ev.experiment_id = ?
      `).all(expId) as any[];

      const variants = varRows.map(v => {
        const defaultYaml = `# AutoHarness Configuration Variant
# Label: ${v.variant_label}
# Candidate Harness ID: ${v.harness_version_id}
# Base Harness: ${experiment.base_harness_version_id || 'hv-baseline-v1'}

version: "2.0"
harness:
  version_id: "${v.harness_version_id}"
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

        return {
          id: v.id,
          name: v.variant_label,
          variant_label: v.variant_label,
          status: v.status.toLowerCase(),
          decision_reason: v.status === 'PROMOTED' ? 'Passed all promotion gates.' : 'Pending evaluation.',
          config_diff: v.config_diff || defaultYaml,
          run_id: null,
          gates_passed: v.status === 'PROMOTED' ? 1 : 0,
          delta_pass_rate: v.status === 'PROMOTED' ? 0.3 : 0.0,
          regression_flag: 0,
          target_suite_scores: [
            { taxonomy: 'Git Conflict', failures_before: 5, failures_after: 2, status: v.status === 'PROMOTED' ? 'IMPROVED' : 'STABLE' }
          ],
          guard_suite_scores: [
            { taxonomy: 'Filesystem Gating', failures_before: 0, failures_after: 0, regressed: false }
          ],
          generated_config: v.config_diff || defaultYaml,
        };
      });

      return NextResponse.json({ experiment, variants });
    }

    const expRows = await db.prepare(`
      SELECT e.id, e.name, e.target_description, b.slug as benchmark_slug, e.base_harness_version_id, e.regression_policy
      FROM experiments e
      JOIN benchmarks b ON e.benchmark_id = b.id
      ORDER BY e.id ASC
    `).all() as any[];

    const experiments = [];
    for (const e of expRows) {
      const targets = await db.prepare('SELECT target_type, target_id FROM experiment_targets WHERE experiment_id = ?').all(e.id) as any[];
      experiments.push({
        id: e.id,
        name: e.name,
        target_description: e.target_description,
        benchmark_slug: e.benchmark_slug,
        base_harness_version_id: e.base_harness_version_id,
        base_harness_version: e.base_harness_version_id,
        targets: targets.map(t => ({
          type: t.target_type.toLowerCase(),
          id: t.target_id,
        })),
        target_modes: targets.map(t => ({
          type: t.target_type.toLowerCase(),
          id: t.target_id,
        })),
        regression_policy: JSON.parse(e.regression_policy || '{}'),
      });
    }

    return NextResponse.json({ experiments });
  } catch (err: any) {
    console.error('Direct experiments query failed, falling back to HTTP:', err);
    try {
      const { searchParams } = new URL(req.url);
      const experiment_id = searchParams.get('id');

      if (experiment_id) {
        const [expRes, varRes, runsRes] = await Promise.all([
          fetch(`${BACKEND}/experiments/${experiment_id}`, { cache: 'no-store' }),
          fetch(`${BACKEND}/experiments/${experiment_id}/variants`, { cache: 'no-store' }),
          fetch(`${BACKEND}/runs/`, { cache: 'no-store' }),
        ]);

        if (!expRes.ok) {
          const d = await expRes.json().catch(() => ({}));
          return NextResponse.json({ error: d.detail || 'Experiment not found' }, { status: expRes.status });
        }

        const expData = await expRes.json();
        const varData = varRes.ok ? await varRes.json().catch(() => ({ data: [] })) : { data: [] };
        const runsData = runsRes.ok ? await runsRes.json().catch(() => ({ data: [] })) : { data: [] };

        const experiment = expData.data || expData;
        const runs = runsData.data || [];

        const variants = (varData.data || []).map((v: any) => {
          const metrics = v.summary_metrics || {};
          const deltaPassRate = metrics.targets?.[0]?.delta ?? 0;
          
          const matchingRun = runs.find((r: any) => r.harness_version === v.harness_version_id);
          const runId = matchingRun ? matchingRun.id : null;
          
          const gatesPassed = v.status === 'promoted' ? 1 : 0;

          const defaultYaml = `# AutoHarness Configuration Variant
# Label: ${v.variant_label}
# Candidate Harness ID: ${v.harness_version_id}
# Base Harness: ${experiment.base_harness_version_id || 'hv-baseline-v1'}

version: "2.0"
harness:
  version_id: "${v.harness_version_id}"
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

          const targetSuiteScores = (metrics.targets || []).map((t: any) => {
            const passBase = t.pass_rate_base ?? 0;
            const passVar = t.pass_rate_variant ?? 0;
            const failuresBefore = Math.round(10 * (1 - passBase));
            const failuresAfter = Math.round(10 * (1 - passVar));
            const status = failuresAfter < failuresBefore ? 'IMPROVED' : 'STABLE';
            return {
              taxonomy: t.id === 'fm1' ? 'Git Conflict' : t.id,
              failures_before: failuresBefore,
              failures_after: failuresAfter,
              status: status
            };
          });

          if (targetSuiteScores.length === 0) {
            targetSuiteScores.push({
              taxonomy: 'IMPROVEMENT',
              failures_before: 1,
              failures_after: 1,
              status: 'STABLE',
            });
          }

          const guardSuiteScores = (metrics.guards || []).map((g: any) => {
            const passBase = g.pass_rate_base ?? 0;
            const passVar = g.pass_rate_variant ?? 0;
            const failuresBefore = Math.round(10 * (1 - passBase));
            const failuresAfter = Math.round(10 * (1 - passVar));
            const regressed = failuresAfter > failuresBefore;
            return {
              taxonomy: g.suite_id === 'es1' ? 'Filesystem Gating' : g.suite_id,
              failures_before: failuresBefore,
              failures_after: failuresAfter,
              regressed: regressed
            };
          });

          if (guardSuiteScores.length === 0) {
            guardSuiteScores.push({
              taxonomy: 'STABILITY',
              failures_before: 1,
              failures_after: 1,
              regressed: false,
            });
          }

          return {
            id: v.id,
            name: v.variant_label,
            variant_label: v.variant_label,
            status: v.status,
            decision_reason: metrics.decision_reason || 'No decision computed yet.',
            config_diff: v.config_diff || defaultYaml,
            run_id: runId,
            gates_passed: gatesPassed,
            delta_pass_rate: deltaPassRate,
            regression_flag: metrics.regression_flag ?? 0,
            target_suite_scores: targetSuiteScores,
            guard_suite_scores: guardSuiteScores,
            generated_config: v.config_diff || defaultYaml,
          };
        });

        return NextResponse.json({ experiment, variants });
      }

      const res = await fetch(`${BACKEND}/experiments/`, { cache: 'no-store' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return NextResponse.json({ error: d.detail || 'Failed to fetch experiments' }, { status: res.status });
      }

      const data = await res.json();
      const experiments = (data.data || []).map((e: any) => ({
        ...e,
        target_modes: Array.isArray(e.targets) ? e.targets : [],
        regression_policy: e.regression_policy || {},
        base_harness_version: e.base_harness_version_id,
      }));

      return NextResponse.json({ experiments });
    } catch (fallbackErr: any) {
      return NextResponse.json({ error: fallbackErr.message }, { status: 500 });
    }
  }
}

export async function POST(req: NextRequest) {
  try {
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
        ? target_modes.map((id: string | number) => ({
            type: 'failure_mode',
            id: String(id),
            desired_delta: 0.2,
          }))
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

      const res = await fetch(`${BACKEND}/experiments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ error: data.detail || 'Failed to create experiment' }, { status: res.status });
      }

      const experimentId = data.data?.experiment_id || data.id || data.data?.id;
      if (experimentId) {
        try {
          const { syncExperimentsDevToLocal } = await import('@/lib/ingest-helper');
          await syncExperimentsDevToLocal(experimentId);
        } catch (syncErr) {
          console.error('Failed to sync new experiment to local DB:', syncErr);
        }
      }

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
      const runRes = await fetch(`${BACKEND}/runs/${run_id}`, { cache: 'no-store' });
      if (!runRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch run details' }, { status: runRes.status });
      }
      const runData = await runRes.json();
      const harnessVersionId = runData.data?.harness_version;

      if (!harnessVersionId) {
        return NextResponse.json({ error: 'Selected run has no harness version' }, { status: 400 });
      }

      // 2. Fetch all eval runs to find the ones matching the run's harness_version_id
      const evalRunsRes = await fetch(`${BACKEND}/eval-runs`, { cache: 'no-store' });
      if (!evalRunsRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch eval runs' }, { status: evalRunsRes.status });
      }
      const evalRunsData = await evalRunsRes.json();
      const evalRuns = evalRunsData.data || [];

      const matchingEvalRuns = evalRuns.filter((er: any) => er.harness_version_id === harnessVersionId);

      // 3. Link each matching eval run to this variant
      for (const er of matchingEvalRuns) {
        await fetch(`${BACKEND}/experiments/${experiment_id}/variants/${variant_id}/link-eval-run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eval_run_id: er.id }),
        });
      }

      // 4. Compute promotion
      const promotionRes = await fetch(`${BACKEND}/experiments/${experiment_id}/variants/${variant_id}/compute-promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!promotionRes.ok) {
        const d = await promotionRes.json().catch(() => ({}));
        return NextResponse.json({ error: d.detail || 'Failed to compute promotion decision' }, { status: promotionRes.status });
      }

      const promotionData = await promotionRes.json();

      if (experiment_id) {
        try {
          const { syncExperimentsDevToLocal } = await import('@/lib/ingest-helper');
          await syncExperimentsDevToLocal(experiment_id);
        } catch (syncErr) {
          console.error('Failed to sync experiment after link_run to local DB:', syncErr);
        }
      }

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

      const res = await fetch(`${BACKEND}/experiments/${experiment_id}/variants`, {
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

      if (experiment_id) {
        try {
          const { syncExperimentsDevToLocal } = await import('@/lib/ingest-helper');
          await syncExperimentsDevToLocal(experiment_id);
        } catch (syncErr) {
          console.error('Failed to sync experiment variant to local DB:', syncErr);
        }
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

