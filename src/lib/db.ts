import { Pool } from 'pg';

/**
 * @deprecated Legacy direct database access layer.
 * All new code should use supabaseServer or supabaseBrowser from `@/lib/supabase-server` / `@/lib/supabase-browser` instead.
 */
if (!process.env.DATABASE_URL) {

  console.error('DATABASE_URL is not set — database queries will fail.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Postgres pool error:', err);
});

// Helper to convert SQLite `?` placeholders to Postgres `$1`, `$2`, ...
function convertSqlForPg(text: string): string {
  let index = 1;
  return text.replace(/\?/g, () => `$${index++}`);
}

export const db = {
  async query(text: string, params: any[] = []): Promise<any[]> {
    const pgText = convertSqlForPg(text);
    const res = await pool.query(pgText, params);
    return res.rows;
  },

  async get(text: string, params: any[] = []): Promise<any> {
    const pgText = convertSqlForPg(text);
    const res = await pool.query(pgText, params);
    return res.rows[0] ?? null;
  },

  async run(text: string, params: any[] = []): Promise<{ lastInsertRowid: any }> {
    const pgText = convertSqlForPg(text);
    const res = await pool.query(pgText, params);
    const insertedRow = res.rows[0];
    const id = insertedRow ? (insertedRow.id ?? insertedRow.lastinsertrowid ?? null) : null;
    return { lastInsertRowid: id };
  },

  prepare(text: string) {
    return {
      all(...params: any[]) {
        return db.query(text, params);
      },
      get(...params: any[]) {
        return db.get(text, params);
      },
      run(...params: any[]) {
        return db.run(text, params);
      },
    };
  },

  transaction(fn: (...args: any[]) => any) {
    return async function (...args: any[]) {
      return await fn(...args);
    };
  },

  exec(text: string) {
    pool.query(text).catch((err) => console.error('exec query failed:', err));
  },

  // no-op: only relevant to SQLite
  pragma(_text: string) {},

  // Expose pool for advanced usage
  pool,
};

export default db;
