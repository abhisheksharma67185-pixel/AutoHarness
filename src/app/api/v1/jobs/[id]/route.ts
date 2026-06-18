import { NextRequest } from 'next/server';
import { checkAuth, sendSuccess, sendError, fetchWithBypass } from '@/lib/api-helper';
import { getJob } from '@/lib/jobs';

const BACKEND = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/_/backend/api/v1`
  : 'http://localhost:8001/api/v1';

const fetch = fetchWithBypass;

interface Params {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { id } = await params;
    
    // First check Next.js internal jobs
    const localJob = getJob(id);
    if (localJob) {
      return sendSuccess(localJob);
    }

    // Fallback to FastAPI backend
    const response = await fetch(`${BACKEND}/jobs/${id}`, { cache: 'no-store' });
    const data = await response.json();

    if (!response.ok) {
      return sendError('NOT_FOUND', `Job not found with ID: ${id}`, { job_id: id }, 404);
    }

    return sendSuccess(data.data);
  } catch (err: any) {
    console.error('Jobs GET route error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error checking job status', null, 500);
  }
}
