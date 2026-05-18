import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'infra', 'migrations', 'postgres');

const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB ?? 'rootpilot',
  user: process.env.POSTGRES_USER ?? 'rootpilot',
  password: process.env.POSTGRES_PASSWORD ?? 'rootpilot',
  connectionTimeoutMillis: 30_000,
});

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedVersions(): Promise<Set<string>> {
  const result = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  return new Set(result.rows.map((row) => row.version));
}

async function applyMigration(filename: string): Promise<void> {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf-8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (version)
       VALUES ($1)
       ON CONFLICT (version) DO NOTHING`,
      [filename],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  console.log('[db:migrate] Starting Postgres migrations...');
  console.log(`[db:migrate] Directory: ${MIGRATIONS_DIR}`);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[db:migrate] No migrations directory found. Nothing to do.');
    return;
  }

  await ensureMigrationsTable();
  const applied = await appliedVersions();
  const migrations = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  let appliedCount = 0;
  for (const migration of migrations) {
    if (applied.has(migration)) {
      console.log(`[db:migrate] Skipping ${migration}; already applied.`);
      continue;
    }
    console.log(`[db:migrate] Applying ${migration}...`);
    await applyMigration(migration);
    appliedCount += 1;
    console.log(`[db:migrate] Applied ${migration}.`);
  }

  console.log(`[db:migrate] Complete. Applied ${appliedCount} migration(s).`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[db:migrate] ERROR: ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
