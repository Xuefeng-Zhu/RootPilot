import pg from 'pg';

const { Pool } = pg;

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

/**
 * Postgres client using pg with connection pool (max 10).
 * Provides parameterized query helper and health check.
 */
const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rootpilot',
  user: process.env.POSTGRES_USER ?? 'rootpilot',
  password: process.env.POSTGRES_PASSWORD ?? 'rootpilot',
  max: 10,
});

/**
 * Execute a parameterized query against Postgres.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const result = await pool.query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount };
}

/**
 * Health check — verifies Postgres connectivity.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully shut down the connection pool.
 */
export async function close(): Promise<void> {
  await pool.end();
}

export { pool };
