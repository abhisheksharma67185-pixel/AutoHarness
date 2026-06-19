import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const { data: list, error } = await supabaseServer
      .from('benchmarks')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;

    const formatted = (list || []).map(b => ({
      id: `b${b.id}`,
      slug: b.slug,
      name: b.name,
      description: b.description,
      source_url: b.source_url
    }));

    return sendSuccess(formatted);
  } catch (err: any) {
    return sendError('SERVER_ERROR', err.message || 'Error fetching benchmarks', null, 500);
  }
}
