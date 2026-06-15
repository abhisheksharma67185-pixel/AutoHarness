import { NextRequest, NextResponse } from 'next/server';
import { fetchWithBypass } from '@/lib/api-helper';

const BACKEND = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/_/backend/api/v1`
  : 'http://localhost:8001/api/v1';

const fetch = fetchWithBypass;

export async function GET(req: NextRequest) {
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
  } catch (err: any) {
    console.error('Failure modes fetch error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
