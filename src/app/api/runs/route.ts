import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBackendUrl } from '@/lib/api-helper';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const benchmarkSlug = searchParams.get('benchmark');

    let url = getBackendUrl('/runs/');
    if (benchmarkSlug) {
      url += `?benchmark_slug=${encodeURIComponent(benchmarkSlug)}`;
    }

    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data.detail || 'Failed to fetch runs' }, { status: response.status });
    }

    // Map FastAPI backend response format to Next.js expectation
    const runs = (data.data || []).map((r: any) => ({
      run_id: r.id,
      run_label: r.run_label,
      global_score: r.global_score,
      metrics: typeof r.metrics === 'string' ? r.metrics : JSON.stringify(r.metrics),
      created_at: r.created_at,
      benchmark: r.benchmark_slug === 'terminal-bench@2.0' ? 'Terminal Bench 2.0' : r.benchmark_slug,
      benchmark_slug: r.benchmark_slug,
      agent: r.agent_name,
      harness_version: r.harness_version
    }));

    return NextResponse.json({ runs });
  } catch (err: any) {
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

    const response = await fetch(getBackendUrl(`/runs/${run_id}`), {
      method: 'DELETE'
    });
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data.detail || 'Failed to delete run' }, { status: response.status });
    }

    // Also delete from local autoharness.db to keep them in sync
    try {
      db.prepare('DELETE FROM runs WHERE id = ?').run(run_id);
    } catch (dbErr: any) {
      console.error('Failed to delete run from local autoharness.db:', dbErr);
    }

    return NextResponse.json({ success: true, message: `Run ${run_id} successfully deleted.` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
