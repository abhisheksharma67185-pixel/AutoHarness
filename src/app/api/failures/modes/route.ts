import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const benchmark_slug = searchParams.get('benchmark_slug');

    let benchmarkId: number | null = null;
    if (benchmark_slug) {
      const { data: bench } = await supabaseServer
        .from('benchmarks')
        .select('id')
        .eq('slug', benchmark_slug)
        .maybeSingle();

      if (!bench) {
        return NextResponse.json({ failureModes: [] });
      }
      benchmarkId = bench.id;
    }

    // Fetch failure modes with member counts and average scores via nested select
    let query = supabaseServer
      .from('failure_modes')
      .select(`
        id,
        name,
        description,
        taxonomy_primary,
        benchmark_id,
        failure_mode_members (
          failure_label_id,
          failure_labels (
            run_task_id,
            run_tasks (
              score
            )
          )
        )
      `);

    if (benchmarkId !== null) {
      query = query.eq('benchmark_id', benchmarkId);
    }

    const { data: rows, error } = await query;

    if (error) {
      throw error;
    }

    // Cache benchmark slugs for lookup
    const benchmarkCache: Record<number, string> = {};

    const failureModes = [];
    for (const fm of (rows || [])) {
      const members = fm.failure_mode_members || [];
      let totalScore = 0;
      let scoreCount = 0;

      for (const m of members) {
        const fl = m.failure_labels as any;
        const rt = fl?.run_tasks as any;
        if (rt?.score !== undefined && rt?.score !== null) {
          totalScore += rt.score;
          scoreCount++;
        }
      }

      let slug = benchmark_slug;
      if (!slug) {
        if (!benchmarkCache[fm.benchmark_id]) {
          const { data: b } = await supabaseServer
            .from('benchmarks')
            .select('slug')
            .eq('id', fm.benchmark_id)
            .maybeSingle();
          benchmarkCache[fm.benchmark_id] = b ? b.slug : 'unknown';
        }
        slug = benchmarkCache[fm.benchmark_id];
      }

      failureModes.push({
        id: `fm${fm.id}`,
        benchmark_id: slug,
        name: fm.name,
        title: fm.name,
        description: fm.description,
        taxonomy_primary: fm.taxonomy_primary,
        taxonomy_label: fm.taxonomy_primary?.toUpperCase(),
        failure_count: members.length,
        avg_score: scoreCount > 0 ? totalScore / scoreCount : 0.0,
        trend: 'stable'
      });
    }

    // Sort by failure_count descending
    failureModes.sort((a, b) => b.failure_count - a.failure_count);

    return NextResponse.json({ failureModes });
  } catch (err: any) {
    console.error('Failure modes query error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
