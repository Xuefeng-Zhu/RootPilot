import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server.js';

vi.mock('../../db/postgres.js', () => ({
  query: vi.fn(),
}));

vi.mock('../../db/clickhouse.js', () => ({
  getClickHouseClient: vi.fn(() => ({
    query: vi.fn().mockResolvedValue([]),
    batchInsert: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn(),
    close: vi.fn(),
  })),
}));

import { query } from '../../db/postgres.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

const mockPgQuery = vi.mocked(query);
const mockGetClickHouseClient = vi.mocked(getClickHouseClient);

function serviceSummaryRow() {
  return {
    id: 'summary-1',
    service_name: 'checkout-service',
    environment: 'production',
    first_seen_at: '2026-05-18T11:00:00.000Z',
    last_seen_at: '2026-05-18T12:00:00.000Z',
    source_signals: {
      logs: true,
      traces: true,
      metrics: true,
      deployments: true,
      log_count: 10,
      span_count: 30,
      metric_count: 20,
      deployment_count: 1,
    },
    latest_version: 'v1.4.2',
    latest_deployment_id: 'deploy-1',
    request_count: 100,
    error_count: 12,
    log_count: 10,
    span_count: 30,
    metric_count: 20,
    deployment_count: 1,
    dependency_count: 3,
    avg_latency_ms: 180,
    p95_latency_ms: 842,
    health_status: 'degraded',
    updated_at: '2026-05-18T12:01:00.000Z',
  };
}

function dependencyRow() {
  return {
    id: 'edge-1',
    environment: 'production',
    source_service: 'checkout-service',
    target_service: 'payment-service',
    operation_name: 'payment.chargeCard',
    call_count: 90,
    error_count: 10,
    avg_duration_ms: 214,
    p95_duration_ms: 931,
    last_seen_at: '2026-05-18T12:00:00.000Z',
    example_trace_id: 'trace-123',
  };
}

function errorGroupRow() {
  return {
    id: 'eg_123',
    service_name: 'checkout-service',
    environment: 'production',
    fingerprint: 'fingerprint',
    error_type: 'PaymentProviderTimeout',
    normalized_message: 'payment provider timeout after <number>ms',
    example_message: 'PaymentProviderTimeout: timeout exceeded after 500ms',
    first_seen_at: '2026-05-18T12:04:00.000Z',
    last_seen_at: '2026-05-18T12:08:00.000Z',
    count: 87,
    affected_traces_count: 12,
    example_trace_id: 'trace-123',
    severity: 'error',
    is_new: true,
    updated_at: '2026-05-18T12:09:00.000Z',
  };
}

function impactRow() {
  return {
    deployment_id: 'deploy-1',
    service_name: 'checkout-service',
    environment: 'production',
    before_window_minutes: 30,
    after_window_minutes: 30,
    error_count_before: 4,
    error_count_after: 87,
    p95_latency_before_ms: 210,
    p95_latency_after_ms: 942,
    new_error_groups_count: 2,
    risk_level: 'high',
    summary_json: {
      signals: [{ type: 'latency', message: 'p95 latency increased from 210ms to 942ms' }],
      example_trace_ids: ['trace-123'],
    },
    calculated_at: '2026-05-18T12:10:00.000Z',
  };
}

function mockValidAuthAndCorrelationRows() {
  mockPgQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('api_keys')) {
      return {
        rows: [{ id: 'key-1', tenant_id: 'tenant-1', revoked_at: null }],
        rowCount: 1,
      } as any;
    }
    if (sql.includes('projects')) {
      return { rows: [{ id: 'project-1' }], rowCount: 1 } as any;
    }
    if (sql.includes('FROM service_summaries')) {
      return { rows: [serviceSummaryRow()], rowCount: 1 } as any;
    }
    if (sql.includes('FROM service_dependencies')) {
      return { rows: [dependencyRow()], rowCount: 1 } as any;
    }
    if (sql.includes('FROM error_groups')) {
      return { rows: [errorGroupRow()], rowCount: 1 } as any;
    }
    if (sql.includes('FROM deployment_impacts')) {
      return { rows: [impactRow()], rowCount: 1 } as any;
    }
    return { rows: [], rowCount: 0 } as any;
  });
}

describe('correlation query routes', () => {
  let app: FastifyInstance;
  let clickhouseQuery: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clickhouseQuery = vi.fn().mockResolvedValue([
      {
        deployment_id: 'deploy-1',
        tenant_id: 'tenant-1',
        project_id: 'project-1',
        timestamp: '2026-05-18T12:00:00.000Z',
        service_name: 'checkout-service',
        environment: 'production',
        version: 'v1.4.2',
        git_sha: 'abc123def',
        deployed_by: 'simulator',
        provider: 'github-actions',
        metadata: '{}',
      },
    ]);
    mockGetClickHouseClient.mockReturnValue({
      query: clickhouseQuery,
      batchInsert: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn(),
      close: vi.fn(),
    } as any);
    mockValidAuthAndCorrelationRows();
  });

  it('returns a tenant-scoped service map', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/service-map?environment=production&from=2026-05-18T11:00:00.000Z&to=2026-05-18T12:00:00.000Z',
      headers: { 'x-api-key': 'valid-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      nodes: [{ id: 'checkout-service', health_status: 'degraded' }],
      edges: [{ environment: 'production', source: 'checkout-service', target: 'payment-service' }],
    });
    const serviceSummaryCall = mockPgQuery.mock.calls.find(([sql]) =>
      String(sql).includes('FROM service_summaries'),
    );
    expect(serviceSummaryCall?.[1]).toContain('tenant-1');
    expect(serviceSummaryCall?.[1]).toContain('project-1');
    expect(String(serviceSummaryCall?.[0])).toContain('last_seen_at <= $5');
    expect(String(serviceSummaryCall?.[0])).not.toContain('first_seen_at <= $5');
  });

  it('returns service details and dependencies', async () => {
    const serviceResponse = await app.inject({
      method: 'GET',
      url: '/v1/services/checkout-service?environment=production',
      headers: { 'x-api-key': 'valid-key' },
    });
    const dependenciesResponse = await app.inject({
      method: 'GET',
      url: '/v1/services/checkout-service/downstream?environment=production',
      headers: { 'x-api-key': 'valid-key' },
    });

    expect(serviceResponse.statusCode).toBe(200);
    expect(serviceResponse.json().data).toMatchObject({
      service_name: 'checkout-service',
      health_status: 'degraded',
      request_count: 100,
    });
    expect(dependenciesResponse.statusCode).toBe(200);
    expect(dependenciesResponse.json().data[0]).toMatchObject({
      target_service: 'payment-service',
      error_count: 10,
    });
  });

  it('returns error groups', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/error-groups?service=checkout-service&is_new=true',
      headers: { 'x-api-key': 'valid-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({
      id: 'eg_123',
      error_type: 'PaymentProviderTimeout',
      is_new: true,
    });
  });

  it('returns deployment impact', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/deployments/deploy-1/impact',
      headers: { 'x-api-key': 'valid-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      deployment: { deployment_id: 'deploy-1', service_name: 'checkout-service' },
      summary: {
        risk_level: 'high',
        error_count_before: 4,
        error_count_after: 87,
      },
      example_trace_ids: ['trace-123'],
    });
  });
});
