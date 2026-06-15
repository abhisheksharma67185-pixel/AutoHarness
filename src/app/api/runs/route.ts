import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBackendUrl, fetchWithBypass } from '@/lib/api-helper';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const benchmarkSlug = searchParams.get('benchmark');

    let query = `
      SELECT r.id as id, r.run_label, r.global_score, r.metrics, r.created_at,
             b.name as benchmark, b.slug as benchmark_slug,
             r.agent_name as agent_name,
             hv.name as harness_version
      FROM runs r
      JOIN benchmarks b ON r.benchmark_id = b.id
      LEFT JOIN harness_versions hv ON r.harness_version_id = hv.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (benchmarkSlug) {
      query += ' AND b.slug = ?';
      params.push(benchmarkSlug);
    }
    query += ' ORDER BY r.created_at DESC';

    const rows = await db.prepare(query).all(...params) as any[];
    const runs = rows.map(r => ({
      run_id: r.id,
      run_label: r.run_label,
      global_score: r.global_score,
      metrics: typeof r.metrics === 'string' ? r.metrics : JSON.stringify(r.metrics),
      created_at: r.created_at,
      benchmark: r.benchmark,
      benchmark_slug: r.benchmark_slug,
      agent: r.agent_name,
      harness_version: r.harness_version || 'unknown'
    }));

    return NextResponse.json({ runs });
  } catch (err: any) {
    console.error('Direct runs query failed, falling back to HTTP:', err);
    try {
      const { searchParams } = new URL(req.url);
      const benchmarkSlug = searchParams.get('benchmark');

      let url = getBackendUrl('/runs/');
      if (benchmarkSlug) {
        url += `?benchmark_slug=${encodeURIComponent(benchmarkSlug)}`;
      }

      const response = await fetchWithBypass(url, { cache: 'no-store' });
      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json({ error: data.detail || 'Failed to fetch runs' }, { status: response.status });
      }

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
    } catch (fallbackErr: any) {
      return NextResponse.json({ error: fallbackErr.message }, { status: 500 });
    }
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const run_id = searchParams.get('run_id');

    if (!run_id) {
      return NextResponse.json({ error: 'Missing run_id' }, { status: 400 });
    }

    const response = await fetchWithBypass(getBackendUrl(`/runs/${run_id}`), {
      method: 'DELETE'
    });
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data.detail || 'Failed to delete run' }, { status: response.status });
    }

    // Also delete from local autoharness.db to keep them in sync
    try {
      await db.prepare('DELETE FROM runs WHERE id = ?').run(run_id);
    } catch (dbErr: any) {
      console.error('Failed to delete run from local autoharness.db:', dbErr);
    }

    return NextResponse.json({ success: true, message: `Run ${run_id} successfully deleted.` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
