import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrl, fetchWithBypass } from '@/lib/api-helper';

// POST /api/jobs - Trigger a background job on the FastAPI backend
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, ...payload } = body;
    const host = req.headers.get('host');

    let endpoint = '';
    switch (type) {
      case 'diagnose':
        endpoint = getBackendUrl('/jobs/diagnose-failures', host);
        break;
      case 'cluster':
        endpoint = getBackendUrl('/jobs/cluster', host);
        break;
      case 'recluster':
        endpoint = getBackendUrl('/jobs/recluster-failure-modes', host);
        break;
      case 'embed':
        endpoint = getBackendUrl('/jobs/embed-failure-labels', host);
        break;
      default:
        return NextResponse.json({ error: `Unknown job type: ${type}` }, { status: 400 });
    }

    const res = await fetchWithBypass(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data;
    const text = await res.text();
    try {
      data = JSON.parse(text || '{}');
    } catch {
      data = { error: text || 'Failed to parse backend response' };
    }

    if (!res.ok) {
      return NextResponse.json({ error: data.detail || data.error || 'Failed to start job' }, { status: res.status });
    }

    return NextResponse.json({ success: true, job: data }, { status: 202 });
  } catch (err: any) {
    console.error('Jobs POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/jobs?job_id=... - Check job status
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const job_id = searchParams.get('job_id');

    if (!job_id) {
      return NextResponse.json({ error: 'Missing job_id' }, { status: 400 });
    }

    const host = req.headers.get('host');
    const res = await fetchWithBypass(getBackendUrl(`/jobs/${encodeURIComponent(job_id)}`, host), { cache: 'no-store' });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: data.detail || 'Job not found' }, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Jobs GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
