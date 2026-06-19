import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET() {
  try {
    const { count, error } = await supabaseServer
      .from('runs')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return NextResponse.json({
        ok: false,
        error: error.message,
        code: error.code,
      });
    }

    return NextResponse.json({ ok: true, count });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message,
    });
  }
}
