/**
 * Database initialization script.
 * Connects to Postgres and ClickHouse, then executes the init SQL files
 * to create the required schemas and tables.
 *
 * Usage: tsx src/scripts/db-init.ts
 * Wired to: npm run db:init (root and workspace)
 *
 * Exits with code 1 and a descriptive error if databases are unreachable
 * within 30 seconds.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from '@clickhouse/client';

const { Pool } = pg;

const TIMEOUT_MS = 30_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve paths to init SQL files relative to project root
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const POSTGRES_SQL_PATH = path.join(PROJECT_ROOT, 'infra', 'init-postgres.sql');
const CLICKHOUSE_SQL_PATH = path.join(PROJECT_ROOT, 'infra', 'init-clickhouse.sql');

/**
 * Creates a timeout promise that rejects after the specified duration.
 */
function createTimeout(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Timeout: ${label} did not respond within ${ms / 1000} seconds`));
    }, ms);
  });
}

/**
 * Initialize Postgres: connect and execute the init SQL.
 */
async function initPostgres(): Promise<void> {
  console.log('[db:init] Connecting to Postgres...');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'rootpilot',
    user: process.env.POSTGRES_USER ?? 'rootpilot',
    password: process.env.POSTGRES_PASSWORD ?? 'rootpilot',
    connectionTimeoutMillis: TIMEOUT_MS,
  });

  try {
    // Verify connectivity
    await pool.query('SELECT 1');
    console.log('[db:init] Postgres connection established.');

    // Read and execute init SQL
    const sql = fs.readFileSync(POSTGRES_SQL_PATH, 'utf-8');
    await pool.query(sql);
    console.log('[db:init] Postgres schema initialized successfully.');
  } finally {
    await pool.end();
  }
}

/**
 * Initialize ClickHouse: connect and execute the init SQL.
 * ClickHouse SQL is split by semicolons and each statement is executed individually.
 */
async function initClickHouse(): Promise<void> {
  console.log('[db:init] Connecting to ClickHouse...');

  const host = process.env.CLICKHOUSE_HOST ?? 'localhost';
  const port = Number(process.env.CLICKHOUSE_PORT ?? 8123);

  const client = createClient({
    url: `http://${host}:${port}`,
    request_timeout: TIMEOUT_MS,
  });

  try {
    // Verify connectivity
    await client.query({ query: 'SELECT 1', format: 'JSONEachRow' });
    console.log('[db:init] ClickHouse connection established.');

    // Read init SQL and split into individual statements
    const sql = fs.readFileSync(CLICKHOUSE_SQL_PATH, 'utf-8');
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      await client.command({ query: statement });
    }

    console.log('[db:init] ClickHouse schema initialized successfully.');
  } finally {
    await client.close();
  }
}

/**
 * Main entry point — runs both init steps with a global timeout.
 */
async function main(): Promise<void> {
  console.log('[db:init] Starting database initialization...');
  console.log(`[db:init] Postgres SQL: ${POSTGRES_SQL_PATH}`);
  console.log(`[db:init] ClickHouse SQL: ${CLICKHOUSE_SQL_PATH}`);

  // Verify SQL files exist
  if (!fs.existsSync(POSTGRES_SQL_PATH)) {
    console.error(`[db:init] ERROR: Postgres init SQL not found at ${POSTGRES_SQL_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(CLICKHOUSE_SQL_PATH)) {
    console.error(`[db:init] ERROR: ClickHouse init SQL not found at ${CLICKHOUSE_SQL_PATH}`);
    process.exit(1);
  }

  try {
    // Run both database initializations with a 30-second timeout
    await Promise.race([
      (async () => {
        await initPostgres();
        await initClickHouse();
      })(),
      createTimeout(TIMEOUT_MS, 'Database initialization'),
    ]);

    console.log('[db:init] All databases initialized successfully.');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[db:init] ERROR: Database initialization failed — ${message}`);
    process.exit(1);
  }
}

main();
