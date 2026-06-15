import { NextRequest } from 'next/server';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';
import { createJob, runBackgroundDiagnosis } from '@/lib/jobs';

interface Params {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { id } = await params;
    
    // Read body if present, default to empty
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    const jobId = createJob('diag');

    // Launch background task without awaiting it
    runBackgroundDiagnosis(jobId, id);

    return sendSuccess({
      job_id: jobId,
      queued: true
    }, 202);
  } catch (err: any) {
    console.error('Trigger failure diagnosis error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error triggering failure diagnosis', null, 500);
  }
}
