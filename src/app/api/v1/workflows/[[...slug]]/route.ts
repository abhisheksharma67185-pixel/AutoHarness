import { NextRequest, NextResponse } from 'next/server';
import { fetchWithBypass, getBackendUrl } from '@/lib/api-helper';

interface Params {
  params: Promise<{
    slug?: string[];
  }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const path = slug ? `/${slug.join('/')}` : '';
    const url = new URL(req.url);
    const search = url.search;
    const host = req.headers.get('host');
    
    const response = await fetchWithBypass(getBackendUrl(`/workflows${path}${search}`, host), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { detail: data.detail || 'Failed to fetch from backend workflows API' },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error calling workflows API';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const path = slug ? `/${slug.join('/')}` : '';
    const body = await req.json().catch(() => null);
    const host = req.headers.get('host');

    const response = await fetchWithBypass(getBackendUrl(`/workflows${path}`, host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { detail: data.detail || 'Failed to post to backend workflows API' },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error calling workflows API';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
