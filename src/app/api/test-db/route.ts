import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export async function GET() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not set' });
  }

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });

  try {
    const res = await pool.query('SELECT count(*) as cnt FROM runs');
    await pool.end();
    return NextResponse.json({ ok: true, count: res.rows[0].cnt, url_prefix: url.slice(0, 40) });
  } catch (err: any) {
    await pool.end().catch(() => {});
    return NextResponse.json({
      ok: false,
      error: err.message,
      code: err.code,
      url_prefix: url.slice(0, 40),
    });
  }
}
