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
    const runId = searchParams.get('run_id');

    if (!benchmarkSlug) {
      return sendError('VALIDATION_ERROR', 'Missing required query parameter: benchmark_slug', { field: 'benchmark_slug' }, 400);
    }

    // Resolve benchmark
    const { data: bench, error: benchError } = await supabaseServer
      .from('benchmarks')
      .select('id')
      .eq('slug', benchmarkSlug)
      .maybeSingle();

    if (benchError) throw benchError;

    if (!bench) {
      return sendSuccess([]); // Return empty list if benchmark slug doesn't exist
    }

    // Fetch failure modes with member details via nested select
    const { data: rows, error: queryError } = await supabaseServer
      .from('failure_modes')
      .select(`
        id,
        name,
        description,
        taxonomy_primary,
        created_at,
        failure_mode_members (
          failure_label_id,
          failure_labels (
            run_task_id,
            run_tasks (
              score,
              run_id,
              runs (
                id,
                harness_versions ( name )
              )
            )
          )
        )
      `)
      .eq('benchmark_id', bench.id);

    if (queryError) throw queryError;

    const formatted = [];
    for (const fm of (rows || [])) {
      const members = fm.failure_mode_members || [];
      
      let totalScore = 0;
      let scoreCount = 0;
      let matchCount = 0;
      const harnessVersionsSet = new Set<string>();

      for (const m of members) {
        const fl = Array.isArray(m.failure_labels) ? m.failure_labels[0] : m.failure_labels;
        const rt = Array.isArray(fl?.run_tasks) ? fl.run_tasks[0] : fl?.run_tasks;
        const run = Array.isArray(rt?.runs) ? rt.runs[0] : rt?.runs;
        const hv = Array.isArray(run?.harness_versions) ? run.harness_versions[0] : run?.harness_versions;

        // If runId is provided, filter by it
        if (runId && run?.id !== runId) {
          continue;
        }

        matchCount++;

        if (rt?.score !== undefined && rt?.score !== null) {
          totalScore += rt.score;
          scoreCount++;
        }

        if (hv?.name) {
          harnessVersionsSet.add(hv.name);
        }
      }

      // If we filtered by runId and there are no matching members, skip this mode
      if (runId && matchCount === 0) {
        continue;
      }

      formatted.push({
        id: `fm${fm.id}`,
        benchmark_slug: benchmarkSlug,
        name: fm.name,
        description: fm.description,
        taxonomy_primary: (fm.taxonomy_primary || 'other').toLowerCase(),
        failure_count: matchCount,
        avg_score: scoreCount > 0 ? totalScore / scoreCount : 0.0,
        affected_harness_versions: Array.from(harnessVersionsSet),
        created_at: new Date(fm.created_at || Date.now()).toISOString()
      });
    }

    // Sort by failure_count descending
    formatted.sort((a, b) => b.failure_count - a.failure_count);

    return sendSuccess(formatted);
  } catch (err: any) {
    console.error('List failure modes error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error fetching failure modes', null, 500);
  }
}
