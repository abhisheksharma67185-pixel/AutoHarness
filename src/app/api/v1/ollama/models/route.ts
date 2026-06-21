import { NextRequest, NextResponse } from 'next/server';
import { fetchWithBypass, getBackendUrl } from '@/lib/api-helper';

export async function GET(req: NextRequest) {
  try {
    const host = req.headers.get('host');
    const response = await fetchWithBypass(getBackendUrl('/ollama/models', host), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { detail: 'Failed to fetch Ollama models' },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Ollama models';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
