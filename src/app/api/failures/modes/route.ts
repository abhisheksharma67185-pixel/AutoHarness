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
    const benchmark_slug = searchParams.get('benchmark_slug') || 'terminal-bench@2.0';

    const bench = db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(benchmark_slug) as any;
    if (!bench) {
      return NextResponse.json({ failureModes: [] });
    }

    let query = `
      SELECT fm.id, fm.name, fm.description, fm.taxonomy_primary,
             COUNT(fmm.failure_label_id) as failure_count,
             AVG(rt.score) as avg_score
      FROM failure_modes fm
      LEFT JOIN failure_mode_members fmm ON fm.id = fmm.failure_mode_id
      LEFT JOIN failure_labels fl ON fmm.failure_label_id = fl.id
      LEFT JOIN run_tasks rt ON fl.run_task_id = rt.id
      WHERE fm.benchmark_id = ?
      GROUP BY fm.id
      ORDER BY failure_count DESC
    `;
    const rows = db.prepare(query).all(bench.id) as any[];
    const failureModes = rows.map(fm => ({
      id: `fm${fm.id}`,
      benchmark_id: benchmark_slug,
      name: fm.name,
      title: fm.name,
      description: fm.description,
      taxonomy_primary: fm.taxonomy_primary,
      taxonomy_label: fm.taxonomy_primary?.toUpperCase(),
      failure_count: fm.failure_count || 0,
      avg_score: fm.avg_score !== null ? fm.avg_score : 0.0,
      trend: 'stable'
    }));

    return NextResponse.json({ failureModes });
  } catch (err: any) {
    console.error('Direct failure modes query failed, falling back to HTTP:', err);
    try {
      const { searchParams } = new URL(req.url);
      const benchmark_slug = searchParams.get('benchmark_slug') || '';

      let url = `${BACKEND}/failure-modes/`;
      if (benchmark_slug) {
        url += `?benchmark_slug=${encodeURIComponent(benchmark_slug)}`;
      }

      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return NextResponse.json({ error: d.detail || 'Failed to fetch failure modes' }, { status: res.status });
      }

      const data = await res.json();
      const failureModes = (data.data || []).map((fm: any) => ({
        id: fm.id,
        benchmark_id: fm.benchmark_slug,
        name: fm.name || fm.title,
        title: fm.title || fm.name,
        description: fm.description,
        taxonomy_primary: fm.taxonomy_primary,
        taxonomy_label: fm.taxonomy_label || fm.taxonomy_primary?.toUpperCase(),
        failure_count: fm.failure_count ?? 0,
        avg_score: fm.avg_score ?? 0,
        trend: fm.trend || 'stable',
      }));

      return NextResponse.json({ failureModes });
    } catch (fallbackErr: any) {
      return NextResponse.json({ error: fallbackErr.message }, { status: 500 });
    }
  }
}
