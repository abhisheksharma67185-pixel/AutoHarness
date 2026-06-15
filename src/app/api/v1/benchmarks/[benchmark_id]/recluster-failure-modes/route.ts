import { NextRequest } from 'next/server';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';
import { createJob, runBackgroundReclustering } from '@/lib/jobs';

interface Params {
  params: Promise<{
    benchmark_id: string;
  }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { benchmark_id } = await params;
    const body = await req.json();
    const { run_ids } = body;

    if (!run_ids || !Array.isArray(run_ids)) {
      return sendError('VALIDATION_ERROR', 'Missing or invalid field run_ids array', { field: 'run_ids' }, 400);
    }

    const benchmarkDbId = parseInt(benchmark_id.replace(/^b/, ''), 10);
    if (isNaN(benchmarkDbId)) {
      return sendError('VALIDATION_ERROR', 'Invalid benchmark_id format', null, 400);
    }

    const jobId = createJob('cluster');

    // Launch local background reclustering task
    runBackgroundReclustering(jobId, benchmarkDbId, run_ids);

    return sendSuccess({
      job_id: jobId
    }, 202);
  } catch (err: any) {
    console.error('Trigger reclustering error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error triggering reclustering', null, 500);
  }
}
