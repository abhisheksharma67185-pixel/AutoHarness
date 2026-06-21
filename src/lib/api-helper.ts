import { NextRequest, NextResponse } from 'next/server';

export function checkAuth(req: NextRequest): boolean {
  const envKey = process.env.STUDIO_API_KEY;
  if (!envKey) return true; // Auth optional/bypassed in dev if no key is configured
  const reqKey = req.headers.get('x-api-key');
  return reqKey === envKey;
}

export function sendSuccess(data: any, status = 200) {
  return NextResponse.json({
    data,
    error: null
  }, { status });
}

export function sendError(code: string, message: string, details: any = null, status = 400) {
  return NextResponse.json({
    data: null,
    error: {
      code,
      message,
      details
    }
  }, { status });
}

export function getBackendUrl(path: string = '', host?: string | null): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const baseHost = host || process.env.VERCEL_URL;
  if (baseHost) {
    return `https://${baseHost}/_/backend/api/v1${cleanPath}`;
  }
  return `http://localhost:8001/api/v1${cleanPath}`;
}

export async function fetchWithBypass(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers.set('x-vercel-protection-bypass', process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  }
  return fetch(url, { ...options, headers });
}


