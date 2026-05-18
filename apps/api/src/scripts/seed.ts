/**
 * Seed script for RootPilot demo data.
 *
 * Creates a demo tenant, project, and API key directly in Postgres,
 * then populates sample telemetry data via the ingestion API endpoints.
 *
 * Usage: tsx src/scripts/seed.ts
 * Wired to: npm run seed (root and workspace)
 *
 * Requires:
 * - Postgres running on localhost:5432 with rootpilot database
 * - API server running on localhost:4000
 */

import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

// ─── Configuration ───────────────────────────────────────────────────────────

const API_BASE_URL = process.env.API_URL ?? 'http://localhost:4000';
const API_KEY = 'rootpilot_demo_key';

const SERVICES = [
  'auth-service',
  'api-gateway',
  'payment-service',
  'user-service',
  'notification-service',
];
const ENVIRONMENTS = ['production', 'staging', 'development'];
const SEVERITIES = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const SEVERITY_NUMBERS: Record<string, number> = {
  TRACE: 2,
  DEBUG: 6,
  INFO: 10,
  WARN: 14,
  ERROR: 18,
  FATAL: 22,
};

const LOG_MESSAGES = [
  'Request processed successfully',
  'Database connection established',
  'Cache miss for key: user_session_{}',
  'Rate limit threshold approaching for client {}',
  'Payment transaction completed: txn_{}',
  'User authentication successful for user_{}',
  'Failed to connect to upstream service',
  'Request timeout after 30000ms',
  'Memory usage above 80% threshold',
  'Service health check passed',
  'Configuration reloaded from remote source',
  'Graceful shutdown initiated',
  'New WebSocket connection established',
  'Background job completed: cleanup_stale_sessions',
  'API response time exceeded SLA: {}ms',
  'Certificate renewal scheduled for next week',
  'Database query slow: {}ms for SELECT on users table',
  'Circuit breaker opened for payment-gateway',
  'Retry attempt 3/5 for message delivery',
  'Deployment rollback triggered due to error rate spike',
];

const OPERATIONS = [
  'GET /api/users',
  'POST /api/auth/login',
  'GET /api/payments/{id}',
  'POST /api/notifications/send',
  'GET /api/health',
  'PUT /api/users/{id}',
  'DELETE /api/sessions/{id}',
  'POST /api/payments/charge',
  'GET /api/orders',
  'POST /api/webhooks/receive',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function recentTimestamp(hoursAgo: number): string {
  const now = Date.now();
  const offset = Math.random() * hoursAgo * 60 * 60 * 1000;
  return new Date(now - offset).toISOString();
}

function toNanos(isoTimestamp: string): string {
  const ms = new Date(isoTimestamp).getTime();
  return (BigInt(ms) * 1_000_000n).toString();
}

async function postJSON(endpoint: string, body: unknown): Promise<void> {
  const url = `${API_BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${endpoint} failed (${res.status}): ${text}`);
  }
}

// ─── Postgres Setup ──────────────────────────────────────────────────────────

async function setupDemoTenant(): Promise<void> {
  console.log('[seed] Setting up demo tenant in Postgres...');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'rootpilot',
    user: process.env.POSTGRES_USER ?? 'rootpilot',
    password: process.env.POSTGRES_PASSWORD ?? 'rootpilot',
    connectionTimeoutMillis: 10_000,
  });

  try {
    // Upsert demo tenant
    const tenantResult = await pool.query(
      `INSERT INTO tenants (name, slug)
       VALUES ('demo', 'demo')
       ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
    );
    const tenantId = tenantResult.rows[0].id;
    console.log(`[seed] Demo tenant ID: ${tenantId}`);

    // Upsert demo project
    await pool.query(
      `INSERT INTO projects (tenant_id, name, slug)
       VALUES ($1, 'default', 'default')
       ON CONFLICT (tenant_id, slug) DO NOTHING`,
      [tenantId],
    );
    console.log('[seed] Demo project created.');

    // Upsert demo API key
    const keyHash = hashApiKey(API_KEY);
    const keyPrefix = API_KEY.slice(0, 8);

    // Check if key already exists
    const existingKey = await pool.query('SELECT id FROM api_keys WHERE key_hash = $1', [keyHash]);

    if (existingKey.rows.length === 0) {
      await pool.query(
        `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name)
         VALUES ($1, $2, $3, 'Demo Key')`,
        [tenantId, keyHash, keyPrefix],
      );
      console.log('[seed] Demo API key created.');
    } else {
      console.log('[seed] Demo API key already exists.');
    }
  } finally {
    await pool.end();
  }
}

// ─── Log Generation ──────────────────────────────────────────────────────────

async function seedLogs(): Promise<void> {
  console.log('[seed] Seeding logs...');

  // Send logs in batches from different services/environments
  for (const service of SERVICES) {
    for (const env of ENVIRONMENTS.slice(0, 2)) {
      const count = randomInt(4, 8);
      const logRecords = [];

      for (let i = 0; i < count; i++) {
        const severity = randomChoice(SEVERITIES);
        const message = randomChoice(LOG_MESSAGES).replace('{}', String(randomInt(100, 9999)));

        logRecords.push({
          timeUnixNano: toNanos(recentTimestamp(24)),
          severityNumber: SEVERITY_NUMBERS[severity],
          severityText: severity,
          body: { stringValue: message },
          attributes: [
            {
              key: 'http.method',
              value: { stringValue: randomChoice(['GET', 'POST', 'PUT', 'DELETE']) },
            },
            {
              key: 'http.status_code',
              value: { intValue: randomChoice([200, 201, 400, 404, 500]) },
            },
          ],
        });
      }

      const payload = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: service } },
                { key: 'deployment.environment', value: { stringValue: env } },
              ],
            },
            scopeLogs: [{ logRecords }],
          },
        ],
      };

      await postJSON('/v1/ingest/logs', payload);
    }
  }

  console.log('[seed] Logs seeded (50+ records across services and environments).');
}

// ─── Trace Generation ────────────────────────────────────────────────────────

function generateTrace(service: string, env: string): unknown {
  const traceId = randomId();
  const rootSpanId = randomId().slice(0, 16);
  const startTime = recentTimestamp(12);
  const startNano = toNanos(startTime);
  const rootDurationMs = randomInt(50, 2000);
  const endNano = (BigInt(startNano) + BigInt(rootDurationMs) * 1_000_000n).toString();

  const operation = randomChoice(OPERATIONS);
  const spans: unknown[] = [];

  // Root span
  spans.push({
    traceId,
    spanId: rootSpanId,
    parentSpanId: '',
    name: operation,
    kind: 2, // SERVER
    startTimeUnixNano: startNano,
    endTimeUnixNano: endNano,
    status: { code: randomChoice([0, 1, 1, 1, 2]) }, // mostly OK
    attributes: [
      { key: 'http.method', value: { stringValue: operation.split(' ')[0] } },
      { key: 'http.route', value: { stringValue: operation.split(' ')[1] } },
    ],
  });

  // Child spans (2-5 per trace)
  const childCount = randomInt(2, 5);
  let currentOffset = BigInt(randomInt(1, 10)) * 1_000_000n;

  for (let i = 0; i < childCount; i++) {
    const childSpanId = randomId().slice(0, 16);
    const childDurationMs = randomInt(5, rootDurationMs / 2);
    const childStartNano = (BigInt(startNano) + currentOffset).toString();
    const childEndNano = (BigInt(childStartNano) + BigInt(childDurationMs) * 1_000_000n).toString();

    const childService = randomChoice(SERVICES);
    const childOps = [
      'db.query',
      'cache.get',
      'http.request',
      'auth.validate',
      'queue.publish',
      'grpc.call',
    ];

    spans.push({
      traceId,
      spanId: childSpanId,
      parentSpanId: rootSpanId,
      name: randomChoice(childOps),
      kind: randomChoice([1, 2, 3, 4, 5]),
      startTimeUnixNano: childStartNano,
      endTimeUnixNano: childEndNano,
      status: { code: randomChoice([0, 1, 1, 2]) },
      attributes: [
        { key: 'peer.service', value: { stringValue: childService } },
        {
          key: 'db.system',
          value: { stringValue: randomChoice(['postgresql', 'redis', 'elasticsearch']) },
        },
      ],
    });

    currentOffset += BigInt(childDurationMs + randomInt(1, 20)) * 1_000_000n;
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: service } },
            { key: 'deployment.environment', value: { stringValue: env } },
          ],
        },
        scopeSpans: [{ spans }],
      },
    ],
  };
}

async function seedTraces(): Promise<void> {
  console.log('[seed] Seeding traces...');

  for (let i = 0; i < 10; i++) {
    const service = randomChoice(SERVICES);
    const env = randomChoice(ENVIRONMENTS);
    const payload = generateTrace(service, env);
    await postJSON('/v1/ingest/traces', payload);
  }

  console.log('[seed] Traces seeded (10 traces with multiple spans each).');
}

// ─── Metric Generation ───────────────────────────────────────────────────────

async function seedMetrics(): Promise<void> {
  console.log('[seed] Seeding metrics...');

  const dataPoints: Array<{ timeUnixNano: string; asDouble: number; attributes: unknown[] }> = [];

  // Generate 20+ metric data points spread across time
  for (let i = 0; i < 25; i++) {
    dataPoints.push({
      timeUnixNano: toNanos(recentTimestamp(6)),
      asDouble: Math.round(Math.random() * 1000 * 100) / 100,
      attributes: [
        { key: 'service.name', value: { stringValue: randomChoice(SERVICES) } },
        { key: 'environment', value: { stringValue: randomChoice(ENVIRONMENTS) } },
      ],
    });
  }

  // Split data points into groups for different metrics
  const metricsPayload = {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: randomChoice(SERVICES) } },
            { key: 'deployment.environment', value: { stringValue: randomChoice(ENVIRONMENTS) } },
          ],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'http_request_duration_ms',
                unit: 'ms',
                gauge: {
                  dataPoints: dataPoints.slice(0, 5),
                },
              },
              {
                name: 'http_requests_total',
                unit: '1',
                sum: {
                  dataPoints: dataPoints.slice(5, 10).map((dp) => ({
                    ...dp,
                    asDouble: Math.floor(dp.asDouble * 10),
                  })),
                  isMonotonic: true,
                  aggregationTemporality: 2,
                },
              },
              {
                name: 'cpu_usage_percent',
                unit: '%',
                gauge: {
                  dataPoints: dataPoints.slice(10, 15).map((dp) => ({
                    ...dp,
                    asDouble: Math.round(Math.random() * 100 * 10) / 10,
                  })),
                },
              },
              {
                name: 'memory_usage_bytes',
                unit: 'By',
                gauge: {
                  dataPoints: dataPoints.slice(15, 20).map((dp) => ({
                    ...dp,
                    asDouble: Math.floor(Math.random() * 4_000_000_000),
                  })),
                },
              },
              {
                name: 'active_connections',
                unit: '1',
                gauge: {
                  dataPoints: dataPoints.slice(20, 25).map((dp) => ({
                    ...dp,
                    asDouble: Math.floor(Math.random() * 500),
                  })),
                },
              },
            ],
          },
        ],
      },
    ],
  };

  await postJSON('/v1/ingest/metrics', metricsPayload);
  console.log('[seed] Metrics seeded (25 data points across 5 metric names).');
}

// ─── Deployment Event Generation ─────────────────────────────────────────────

async function seedDeployments(): Promise<void> {
  console.log('[seed] Seeding deployment events...');

  const deployments = [
    {
      service_name: 'auth-service',
      environment: 'production',
      version: 'v2.4.1',
      git_sha: 'abc123def456',
      deployed_by: 'ci-pipeline',
      provider: 'github-actions',
      timestamp: recentTimestamp(2),
      metadata: { pr_number: 142, build_duration_s: 87 },
    },
    {
      service_name: 'api-gateway',
      environment: 'production',
      version: 'v1.12.0',
      git_sha: '789xyz012abc',
      deployed_by: 'ci-pipeline',
      provider: 'github-actions',
      timestamp: recentTimestamp(6),
      metadata: { pr_number: 305, build_duration_s: 124 },
    },
    {
      service_name: 'payment-service',
      environment: 'staging',
      version: 'v3.0.0-rc1',
      git_sha: 'def456ghi789',
      deployed_by: 'developer@example.com',
      provider: 'argocd',
      timestamp: recentTimestamp(12),
      metadata: { pr_number: 88, canary: true },
    },
    {
      service_name: 'user-service',
      environment: 'development',
      version: 'v1.8.3-dev',
      git_sha: 'fea901bcd234',
      deployed_by: 'developer@example.com',
      provider: 'docker-compose',
      timestamp: recentTimestamp(1),
      metadata: { local_dev: true },
    },
  ];

  for (const deployment of deployments) {
    await postJSON('/v1/events/deployments', deployment);
  }

  console.log('[seed] Deployment events seeded (4 events across services).');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[seed] Starting RootPilot seed script...');
  console.log(`[seed] API target: ${API_BASE_URL}`);
  console.log(`[seed] API key: ${API_KEY.slice(0, 8)}...`);

  try {
    // Step 1: Create demo tenant/project/API key in Postgres
    await setupDemoTenant();

    // Step 2: Seed telemetry data via API endpoints
    await seedLogs();
    await seedTraces();
    await seedMetrics();
    await seedDeployments();

    console.log('[seed] ✓ Seed completed successfully!');
    console.log('[seed] Summary:');
    console.log('[seed]   - Demo tenant: "demo" (slug: demo)');
    console.log('[seed]   - Demo project: "default" (slug: default)');
    console.log('[seed]   - API key: rootpilot_demo_key');
    console.log('[seed]   - 50+ log records');
    console.log('[seed]   - 10 traces with multiple spans each');
    console.log('[seed]   - 25 metric data points');
    console.log('[seed]   - 4 deployment events');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[seed] ERROR: Seed failed — ${message}`);
    process.exit(1);
  }
}

main();
