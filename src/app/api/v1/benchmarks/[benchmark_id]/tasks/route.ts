import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';

interface Params {
  params: Promise<{
    benchmark_id: string;
  }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { benchmark_id } = await params;
    const cleanId = benchmark_id.startsWith('b') ? benchmark_id.slice(1) : benchmark_id;
    const idNum = parseInt(cleanId, 10);

    if (isNaN(idNum)) {
      return sendError('VALIDATION_ERROR', 'Invalid benchmark_id format', { field: 'benchmark_id' }, 400);
    }

    // Parse query params
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const tasks = await db.prepare(`
      SELECT * FROM benchmark_tasks
      WHERE benchmark_id = ?
      ORDER BY id ASC
      LIMIT ? OFFSET ?
    `).all(idNum, limit, offset) as any[];

    const formatted = tasks.map(t => {
      let meta = {};
      try {
        meta = JSON.parse(t.metadata || '{}');
      } catch {}
      return {
        id: `bt${t.id}`,
        task_id: t.task_id,
        title: t.title,
        category: (t.category || '').toLowerCase(),
        difficulty: (t.difficulty || '').toLowerCase(),
        metadata: meta
      };
    });

    return sendSuccess(formatted);
  } catch (err: any) {
    return sendError('SERVER_ERROR', err.message || 'Error fetching benchmark tasks', null, 500);
  }
}
