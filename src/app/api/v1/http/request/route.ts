import { NextRequest, NextResponse } from 'next/server';
import { fetchWithBypass, getBackendUrl } from '@/lib/api-helper';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface HttpRequestPayload {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: JsonValue;
}

interface BackendError {
  detail?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as HttpRequestPayload;

    const response = await fetchWithBypass(getBackendUrl('/http/request'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as BackendError | unknown;

    if (!response.ok) {
      const error = data as BackendError;
      return NextResponse.json(
        { detail: error.detail || error.error || 'HTTP request failed' },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'HTTP request failed';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
