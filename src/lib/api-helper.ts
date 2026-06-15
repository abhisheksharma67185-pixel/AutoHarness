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
