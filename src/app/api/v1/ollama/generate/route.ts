import { NextRequest, NextResponse } from 'next/server';
import { fetchWithBypass, getBackendUrl } from '@/lib/api-helper';

interface GeneratePayload {
  model: string;
  prompt: string;
  temperature?: number;
  max_tokens?: number | null;
}

interface BackendError {
  detail?: string;
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as GeneratePayload;
    const host = req.headers.get('host');

    const response = await fetchWithBypass(getBackendUrl('/ollama/generate', host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = data as BackendError;
      return NextResponse.json(
        { detail: error.detail || 'Ollama request failed' },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Ollama request failed';
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
