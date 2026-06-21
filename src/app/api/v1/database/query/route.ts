import { NextRequest, NextResponse } from 'next/server';
import { fetchWithBypass, getBackendUrl } from '@/lib/api-helper';

interface DatabaseQueryPayload {
  query: string;
  params?: Record<string, string | number | boolean | null>;
  query_type?: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  table_name?: string;
}

interface BackendError {
  detail?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as DatabaseQueryPayload;
    const host = req.headers.get('host');

    const response = await fetchWithBypass(getBackendUrl('/database/query', host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as BackendError | unknown;

    if (!response.ok) {
      const error = data as BackendError;
      return NextResponse.json(
        { detail: error.detail || error.error || 'Database query failed' },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Database query failed';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
