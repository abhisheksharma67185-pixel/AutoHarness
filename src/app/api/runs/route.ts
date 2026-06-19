import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const benchmarkSlug = searchParams.get('benchmark');

    let query = supabaseServer
      .from('runs')
      .select(`
        id,
        run_label,
        global_score,
        metrics,
        created_at,
        agent_name,
        benchmarks!inner ( name, slug ),
        harness_versions ( name )
      `)
      .order('created_at', { ascending: false });

    if (benchmarkSlug) {
      query = query.eq('benchmarks.slug', benchmarkSlug);
    }

    const { data: rows, error } = await query;

    if (error) {
      throw error;
    }

    const runs = (rows || []).map((r: any) => ({
      run_id: r.id,
      run_label: r.run_label,
      global_score: r.global_score,
      metrics: typeof r.metrics === 'string' ? r.metrics : JSON.stringify(r.metrics),
      created_at: r.created_at,
      benchmark: r.benchmarks?.name,
      benchmark_slug: r.benchmarks?.slug,
      agent: r.agent_name,
      harness_version: r.harness_versions?.name || 'unknown'
    }));

    return NextResponse.json({ runs });
  } catch (err: any) {
    console.error('Supabase runs query failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const run_id = searchParams.get('run_id');

    if (!run_id) {
      return NextResponse.json({ error: 'Missing run_id' }, { status: 400 });
    }

    // Cascading delete handled by Supabase FK constraints
    const { error } = await supabaseServer
      .from('runs')
      .delete()
      .eq('id', run_id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, message: `Run ${run_id} successfully deleted.` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
