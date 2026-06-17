import { NextRequest, NextResponse } from 'next/server';
import { fetchWithBypass, getBackendUrl } from '@/lib/api-helper';

interface BackendError {
  detail?: { message?: string; details?: unknown };
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const response = await fetchWithBypass(getBackendUrl('/pipelines/validate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = data as BackendError;
      return NextResponse.json(
        {
          detail:
            error.detail?.message || error.detail || 'Pipeline validation failed',
        },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Validation failed';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
