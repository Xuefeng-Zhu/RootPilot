import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server.js';

// Mock the postgres module for auth middleware
vi.mock('../../db/postgres.js', () => ({
  query: vi.fn(),
}));

// Mock the clickhouse module
vi.mock('../../db/clickhouse.js', () => ({
  getClickHouseClient: vi.fn(() => ({
    batchInsert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
  })),
}));

import { query } from '../../db/postgres.js';
import { getClickHouseClient } from '../../db/clickhouse.js';

const mockQuery = vi.mocked(query);
const mockGetClickHouseClient = vi.mocked(getClickHouseClient);

// Helper to set up auth mock for a valid API key
function mockValidAuth() {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('api_keys')) {
      return {
        rows: [{ id: 'key-1', tenant_id: 'tenant-1', revoked_at: null }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any;
    }
    if (sql.includes('projects')) {
      return {
        rows: [{ id: 'project-1' }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as any;
    }
    return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
  });
}

function makeSampleTraceSummary(overrides: Partial<Record<string, unknown>> = {}) {
  const timestamp =
    (overrides.trace_timestamp as string) ??
    (overrides.timestamp as string) ??
    '2024-01-15T10:30:00.000';

  return {
    trace_id: (overrides.trace_id as string) ?? 'trace-abc-123',
    trace_timestamp: timestamp,
    root_service: (overrides.root_service as string) ?? 'api-gateway',
    root_operation: (overrides.root_operation as string) ?? 'GET /users',
    root_environment: (overrides.root_environment as string) ?? 'production',
    duration_ms: (overrides.duration_ms as number) ?? 150.5,
    span_count: (overrides.span_count as number) ?? 5,
    error_count: (overrides.error_count as number) ?? 0,
    services: (overrides.services as string[]) ?? ['api-gateway', 'user-service'],
    status: (overrides.status as string) ?? 'OK',
  };
}

function makeSampleSpanRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: (overrides.id as string) ?? 'span-id-1',
    tenant_id: (overrides.tenant_id as string) ?? 'tenant-1',
    project_id: (overrides.project_id as string) ?? 'project-1',
    timestamp: (overrides.timestamp as string) ?? '2024-01-15T10:30:00.000',
    received_at: (overrides.received_at as string) ?? '2024-01-15T10:30:01.000',
    service_name: (overrides.service_name as string) ?? 'api-gateway',
    environment: (overrides.environment as string) ?? 'production',
    source: (overrides.source as string) ?? '',
    resource_attributes: (overrides.resource_attributes as string) ?? '{}',
    attributes: (overrides.attributes as string) ?? '{}',
    trace_id: (overrides.trace_id as string) ?? 'trace-abc-123',
    span_id: (overrides.span_id as string) ?? 'span-001',
    parent_span_id: (overrides.parent_span_id as string) ?? '',
    operation_name: (overrides.operation_name as string) ?? 'GET /users',
    duration_ms: (overrides.duration_ms as number) ?? 150.5,
    status_code: (overrides.status_code as string) ?? 'OK',
    status_message: (overrides.status_message as string) ?? '',
    kind: (overrides.kind as string) ?? 'SERVER',
  };
}

function makeSampleLogRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: (overrides.id as string) ?? 'log-1',
    tenant_id: (overrides.tenant_id as string) ?? 'tenant-1',
    project_id: (overrides.project_id as string) ?? 'project-1',
    timestamp: (overrides.timestamp as string) ?? '2024-01-15T10:30:00.000',
    received_at: (overrides.received_at as string) ?? '2024-01-15T10:30:01.000',
    service_name: (overrides.service_name as string) ?? 'api-gateway',
    environment: (overrides.environment as string) ?? 'production',
    source: (overrides.source as string) ?? '',
    resource_attributes: (overrides.resource_attributes as string) ?? '{}',
    attributes: (overrides.attributes as string) ?? '{}',
    severity: (overrides.severity as string) ?? 'ERROR',
    message: (overrides.message as string) ?? 'Cache failed',
    trace_id: (overrides.trace_id as string) ?? 'trace-abc-123',
    span_id: (overrides.span_id as string) ?? 'span-001',
    fingerprint: (overrides.fingerprint as string) ?? 'cache-failed',
  };
}

describe('GET /v1/traces', () => {
  let app: FastifyInstance;
  let mockClickhouseQuery: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockClickhouseQuery = vi.fn().mockResolvedValue([]);
    mockGetClickHouseClient.mockReturnValue({
      batchInsert: vi.fn().mockResolvedValue(undefined),
      query: mockClickhouseQuery,
      healthCheck: vi.fn(),
      close: vi.fn(),
    } as any);
    mockValidAuth();
  });

  describe('Authentication', () => {
    it('returns 401 when X-API-Key header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 when X-API-Key is invalid', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('api_keys')) {
          return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
        }
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'invalid-key' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_INVALID');
    });
  });

  describe('Parameter validation', () => {
    it('returns 400 for malformed from timestamp', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?from=not-a-date',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('from');
    });

    it('returns 400 for malformed to timestamp', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?to=invalid-timestamp',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('to');
    });

    it('returns 400 for negative minDuration', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?minDuration=-10',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('minDuration');
    });

    it('returns 400 for non-numeric minDuration', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?minDuration=abc',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('minDuration');
    });

    it('returns 400 when limit exceeds 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?limit=201',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('200');
    });

    it('returns 400 when limit is not a positive integer', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?limit=-1',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('limit');
    });

    it('returns 400 for malformed cursor', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?cursor=not-valid-base64',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('cursor');
    });

    it('returns 400 for unsupported status filters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?status=TRACE',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('status');
      expect(mockClickhouseQuery).not.toHaveBeenCalled();
    });

    it('returns 400 when maxDuration is lower than minDuration', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?minDuration=500&maxDuration=100',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('maxDuration');
      expect(mockClickhouseQuery).not.toHaveBeenCalled();
    });

    it('returns 400 for malformed trace_id filters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces?trace_id=bad%20trace',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('trace_id');
      expect(mockClickhouseQuery).not.toHaveBeenCalled();
    });
  });

  describe('Successful queries', () => {
    it('returns empty data array with hasMore false when no results', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toEqual([]);
      expect(body.pagination.cursor).toBeNull();
      expect(body.pagination.hasMore).toBe(false);
    });

    it('returns trace summaries with correct structure', async () => {
      mockClickhouseQuery.mockResolvedValue([makeSampleTraceSummary()]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        trace_id: 'trace-abc-123',
        root_service: 'api-gateway',
        root_operation: 'GET /users',
        duration_ms: 150.5,
        span_count: 5,
        status: 'OK',
        timestamp: '2024-01-15T10:30:00.000',
      });
      expect(body.pagination.hasMore).toBe(false);
    });

    it('defaults time range to last 1 hour when not specified', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(mockClickhouseQuery).toHaveBeenCalledTimes(1);
      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain(
        "timestamp >= parseDateTime64BestEffort({fromTime:String}, 3, 'UTC')",
      );
      expect(queryText).toContain(
        "timestamp <= parseDateTime64BestEffort({toTime:String}, 3, 'UTC')",
      );
      expect(queryParams.fromTime).toBeDefined();
      expect(queryParams.toTime).toBeDefined();

      // Verify the time range is approximately 1 hour
      const from = new Date(queryParams.fromTime as string).getTime();
      const to = new Date(queryParams.toTime as string).getTime();
      const diffMs = to - from;
      expect(diffMs).toBeGreaterThanOrEqual(3500000); // ~58 minutes
      expect(diffMs).toBeLessThanOrEqual(3700000); // ~62 minutes
    });

    it('always includes tenant_id in WHERE clause', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('tenant_id = {tenantId:String}');
      expect(queryParams.tenantId).toBe('tenant-1');
    });

    it('applies service filter', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces?service=api-gateway',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('service_name = {service:String}');
      expect(queryParams.service).toBe('api-gateway');
    });

    it('matches child span filters without using child spans as root fallbacks', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces?service=checkout-service&operation=checkout',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('trace_id IN (SELECT DISTINCT trace_id FROM spans WHERE');
      expect(queryText).toContain('service_name = {service:String}');
      expect(queryText).toContain(
        'positionCaseInsensitive(operation_name, {operation:String}) > 0',
      );
      expect(queryText).toContain("argMinIf(service_name, timestamp, parent_span_id = '')");
      expect(queryText).not.toContain('argMin(service_name, timestamp)');
      expect(queryParams).toMatchObject({
        service: 'checkout-service',
        operation: 'checkout',
      });
    });

    it('applies environment filter', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces?environment=production',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('environment = {environment:String}');
      expect(queryParams.environment).toBe('production');
    });

    it('applies minDuration filter in HAVING clause', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces?minDuration=100',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('HAVING');
      expect(queryText).toContain('duration_ms >= {minDuration:Float64}');
      expect(queryParams.minDuration).toBe(100);
    });

    it('applies extended trace filters with parameterized query values', async () => {
      mockClickhouseQuery.mockResolvedValue([]);
      const route = encodeURIComponent('/api/checkout');

      await app.inject({
        method: 'GET',
        url: `/v1/traces?operation=checkout&status=ERROR&maxDuration=500&trace_id=trace_123&root_service=checkout-service&http_route=${route}&error_only=true`,
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain(
        'positionCaseInsensitive(operation_name, {operation:String}) > 0',
      );
      expect(queryText).toContain('trace_id = {traceId:String}');
      expect(queryText).toContain("JSONExtractString(attributes, 'http.route')");
      expect(queryText).toContain('duration_ms <= {maxDuration:Float64}');
      expect(queryText).toContain('status = {status:String}');
      expect(queryText).toContain('error_count > 0');
      expect(queryText).toContain('root_service = {rootService:String}');
      expect(queryParams).toMatchObject({
        tenantId: 'tenant-1',
        operation: 'checkout',
        status: 'ERROR',
        maxDuration: 500,
        traceId: 'trace_123',
        rootService: 'checkout-service',
        httpRoute: '/api/checkout',
      });
    });

    it('applies time range filter with from and to parameters', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces?from=2024-01-15T00:00:00Z&to=2024-01-15T23:59:59Z',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryParams.fromTime).toBe('2024-01-15T00:00:00Z');
      expect(queryParams.toTime).toBe('2024-01-15T23:59:59Z');
    });

    it('preserves explicit timezone offsets for UTC-aware ClickHouse parsing', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces?from=2024-01-15T02:00:00-08:00&to=2024-01-15T03:30:00-08:00',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain(
        "timestamp >= parseDateTime64BestEffort({fromTime:String}, 3, 'UTC')",
      );
      expect(queryText).toContain(
        "timestamp <= parseDateTime64BestEffort({toTime:String}, 3, 'UTC')",
      );
      expect(queryParams.fromTime).toBe('2024-01-15T02:00:00-08:00');
      expect(queryParams.toTime).toBe('2024-01-15T03:30:00-08:00');
    });

    it('uses default limit of 50 when not specified', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryParams.fetchLimit).toBe(51);
    });

    it('uses custom limit when specified', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces?limit=10',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryParams.fetchLimit).toBe(11);
    });

    it('handles string span_count and duration_ms from ClickHouse', async () => {
      mockClickhouseQuery.mockResolvedValue([
        makeSampleTraceSummary({ span_count: '8', duration_ms: '250.75' }),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data[0].span_count).toBe(8);
      expect(body.data[0].duration_ms).toBe(250.75);
    });

    it('returns empty string for root_service and root_operation when no root span', async () => {
      mockClickhouseQuery.mockResolvedValue([
        makeSampleTraceSummary({ root_service: '', root_operation: '' }),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data[0].root_service).toBe('');
      expect(body.data[0].root_operation).toBe('');
    });

    it('returns latency buckets, error counts, services, and deployment hints', async () => {
      mockClickhouseQuery
        .mockResolvedValueOnce([
          makeSampleTraceSummary({
            trace_id: 'trace-fast',
            duration_ms: 50,
            error_count: 1,
            status: 'ERROR',
          }),
          makeSampleTraceSummary({ trace_id: 'trace-mid', duration_ms: 150 }),
          makeSampleTraceSummary({ trace_id: 'trace-slow', duration_ms: 500 }),
          makeSampleTraceSummary({ trace_id: 'trace-second', duration_ms: 1500 }),
          makeSampleTraceSummary({ trace_id: 'trace-very-slow', duration_ms: 4000 }),
        ])
        .mockResolvedValueOnce([
          {
            deployment_id: 'deploy-1',
            timestamp: '2024-01-15T10:25:00.000',
            service_name: 'api-gateway',
            environment: 'production',
          },
        ])
        .mockResolvedValueOnce([
          { bucket: '<100ms', count: 1 },
          { bucket: '100-300ms', count: 1 },
          { bucket: '300-1000ms', count: 1 },
          { bucket: '1-3s', count: 1 },
          { bucket: '>3s', count: 1 },
        ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data[0]).toMatchObject({
        trace_id: 'trace-fast',
        error_count: 1,
        services: ['api-gateway', 'user-service'],
        near_deployment: true,
        deployment_id: 'deploy-1',
      });
      expect(body.summary.latency_buckets).toEqual([
        { bucket: '<100ms', count: 1 },
        { bucket: '100-300ms', count: 1 },
        { bucket: '300-1000ms', count: 1 },
        { bucket: '1-3s', count: 1 },
        { bucket: '>3s', count: 1 },
      ]);
    });
  });

  describe('Pagination', () => {
    it('returns hasMore true and cursor when more results exist', async () => {
      // Return limit + 1 rows to indicate more results
      const rows = Array.from({ length: 51 }, (_, i) =>
        makeSampleTraceSummary({
          trace_id: `trace-${i}`,
          timestamp: `2024-01-15T10:${String(30 - Math.floor(i / 2)).padStart(2, '0')}:00.000`,
        }),
      );
      mockClickhouseQuery.mockResolvedValue(rows);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data).toHaveLength(50);
      expect(body.pagination.hasMore).toBe(true);
      expect(body.pagination.cursor).not.toBeNull();

      // Verify cursor is valid base64 JSON
      const decoded = JSON.parse(Buffer.from(body.pagination.cursor, 'base64').toString());
      expect(decoded).toHaveProperty('ts');
      expect(decoded).toHaveProperty('id');
    });

    it('returns hasMore false when results are less than limit', async () => {
      const rows = [makeSampleTraceSummary()];
      mockClickhouseQuery.mockResolvedValue(rows);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.pagination.hasMore).toBe(false);
      expect(body.pagination.cursor).toBeNull();
    });

    it('applies cursor to query when provided', async () => {
      const cursor = Buffer.from(
        JSON.stringify({ ts: '2024-01-15T10:00:00.000', id: 'trace-50' }),
      ).toString('base64');

      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/v1/traces?cursor=${cursor}`,
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('cursorTs');
      expect(queryText).toContain('cursorId');
      expect(queryParams.cursorTs).toBe('2024-01-15T10:00:00.000');
      expect(queryParams.cursorId).toBe('trace-50');
    });
  });

  describe('Query structure', () => {
    it('groups by trace_id for aggregation', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('GROUP BY trace_id');
    });

    it('orders results by aggregated trace timestamp DESC, trace_id DESC', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('ORDER BY trace_timestamp DESC, trace_id DESC');
    });
  });
});

describe('GET /v1/traces/:traceId', () => {
  let app: FastifyInstance;
  let mockClickhouseQuery: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockClickhouseQuery = vi.fn().mockResolvedValue([]);
    mockGetClickHouseClient.mockReturnValue({
      batchInsert: vi.fn().mockResolvedValue(undefined),
      query: mockClickhouseQuery,
      healthCheck: vi.fn(),
      close: vi.fn(),
    } as any);
    mockValidAuth();
  });

  describe('Authentication', () => {
    it('returns 401 when X-API-Key header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/some-trace-id',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('Trace not found', () => {
    it('returns 404 when trace does not exist', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/non-existent-trace',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('non-existent-trace');
    });

    it('returns 404 for cross-tenant trace lookup (tenant isolation)', async () => {
      // The query scopes to tenant_id, so a trace belonging to another tenant
      // will return 0 rows, resulting in 404
      mockClickhouseQuery.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/trace-from-other-tenant',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('Successful trace detail', () => {
    it('returns all spans for a trace sorted by start time', async () => {
      const spans = [
        makeSampleSpanRow({ span_id: 'span-001', timestamp: '2024-01-15T10:30:00.000' }),
        makeSampleSpanRow({
          span_id: 'span-002',
          timestamp: '2024-01-15T10:30:01.000',
          parent_span_id: 'span-001',
        }),
        makeSampleSpanRow({
          span_id: 'span-003',
          timestamp: '2024-01-15T10:30:02.000',
          parent_span_id: 'span-001',
        }),
      ];
      mockClickhouseQuery.mockResolvedValue(spans);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/trace-abc-123',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(3);
      expect(body.data[0].span_id).toBe('span-001');
      expect(body.data[1].span_id).toBe('span-002');
      expect(body.data[2].span_id).toBe('span-003');
    });

    it('returns spans with correct structure', async () => {
      mockClickhouseQuery.mockResolvedValue([makeSampleSpanRow()]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/trace-abc-123',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data[0]).toMatchObject({
        id: 'span-id-1',
        tenant_id: 'tenant-1',
        project_id: 'project-1',
        service_name: 'api-gateway',
        environment: 'production',
        trace_id: 'trace-abc-123',
        span_id: 'span-001',
        parent_span_id: null, // empty string becomes null
        operation_name: 'GET /users',
        duration_ms: 150.5,
        status_code: 'OK',
        kind: 'SERVER',
      });
    });

    it('returns trace detail summary with related logs and deployment hint', async () => {
      mockClickhouseQuery
        .mockResolvedValueOnce([
          makeSampleSpanRow({
            span_id: 'span-root',
            parent_span_id: '',
            timestamp: '2024-01-15T10:30:00.000',
            duration_ms: 200,
          }),
          makeSampleSpanRow({
            span_id: 'span-child',
            parent_span_id: 'span-root',
            service_name: 'checkout-service',
            operation_name: 'POST /checkout',
            timestamp: '2024-01-15T10:30:00.050',
            duration_ms: 75,
            status_code: 'ERROR',
          }),
        ])
        .mockResolvedValueOnce([{ count: 2 }])
        .mockResolvedValueOnce([
          {
            deployment_id: 'deploy-1',
            timestamp: '2024-01-15T10:25:00.000',
            service_name: 'api-gateway',
            environment: 'production',
          },
        ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/trace-abc-123',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.summary).toMatchObject({
        trace_id: 'trace-abc-123',
        root_service: 'api-gateway',
        root_operation: 'GET /users',
        duration_ms: 200,
        status: 'ERROR',
        span_count: 2,
        error_count: 1,
        related_logs_count: 2,
        deployment: { near_deployment: true, deployment_id: 'deploy-1' },
      });
      expect(body.summary.services).toEqual(['api-gateway', 'checkout-service']);
    });

    it('selects the nearest deployment hint on trace detail', async () => {
      mockClickhouseQuery
        .mockResolvedValueOnce([
          makeSampleSpanRow({
            span_id: 'span-root',
            parent_span_id: '',
            timestamp: '2024-01-15T10:30:00.000',
          }),
        ])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([
          {
            deployment_id: 'deploy-later',
            timestamp: '2024-01-15T10:40:00.000',
            service_name: 'api-gateway',
            environment: 'production',
          },
          {
            deployment_id: 'deploy-nearest',
            timestamp: '2024-01-15T10:31:00.000',
            service_name: 'api-gateway',
            environment: 'production',
          },
        ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/trace-abc-123',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().summary.deployment).toEqual({
        near_deployment: true,
        deployment_id: 'deploy-nearest',
      });
    });

    it('parses resource_attributes and attributes from JSON strings', async () => {
      mockClickhouseQuery.mockResolvedValue([
        makeSampleSpanRow({
          resource_attributes: '{"service.name":"api-gateway"}',
          attributes: '{"http.method":"GET"}',
        }),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/trace-abc-123',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data[0].resource_attributes).toEqual({ 'service.name': 'api-gateway' });
      expect(body.data[0].attributes).toEqual({ 'http.method': 'GET' });
    });

    it('sets parent_span_id to null for root spans (empty string)', async () => {
      mockClickhouseQuery.mockResolvedValue([makeSampleSpanRow({ parent_span_id: '' })]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/trace-abc-123',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data[0].parent_span_id).toBeNull();
    });

    it('preserves parent_span_id for child spans', async () => {
      mockClickhouseQuery.mockResolvedValue([
        makeSampleSpanRow({ parent_span_id: 'parent-span-001' }),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/trace-abc-123',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data[0].parent_span_id).toBe('parent-span-001');
    });

    it('always scopes query to tenant_id', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces/some-trace',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('tenant_id = {tenantId:String}');
      expect(queryParams.tenantId).toBe('tenant-1');
    });

    it('limits results to 10,000 spans', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces/some-trace',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('LIMIT 10000');
    });

    it('orders spans by timestamp ASC', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces/some-trace',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('ORDER BY timestamp ASC');
    });

    it('handles string duration_ms from ClickHouse', async () => {
      mockClickhouseQuery.mockResolvedValue([makeSampleSpanRow({ duration_ms: '300.25' as any })]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traces/trace-abc-123',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data[0].duration_ms).toBe(300.25);
    });
  });
});

describe('Trace drilldown endpoints', () => {
  let app: FastifyInstance;
  let mockClickhouseQuery: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockClickhouseQuery = vi.fn().mockResolvedValue([]);
    mockGetClickHouseClient.mockReturnValue({
      batchInsert: vi.fn().mockResolvedValue(undefined),
      query: mockClickhouseQuery,
      healthCheck: vi.fn(),
      close: vi.fn(),
    } as any);
    mockValidAuth();
  });

  it('returns related logs for a trace with optional span filter', async () => {
    mockClickhouseQuery.mockResolvedValueOnce([
      makeSampleLogRow({ span_id: 'span-child', message: 'span-specific log' }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/traces/trace-abc-123/logs?span_id=span-child',
      headers: { 'x-api-key': 'valid-key' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data[0]).toMatchObject({
      trace_id: 'trace-abc-123',
      span_id: 'span-child',
      message: 'span-specific log',
    });
    const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
    expect(queryText).toContain('tenant_id = {tenantId:String}');
    expect(queryText).toContain('trace_id = {traceId:String}');
    expect(queryText).toContain('span_id = {spanId:String}');
    expect(queryParams).toMatchObject({
      tenantId: 'tenant-1',
      traceId: 'trace-abc-123',
      spanId: 'span-child',
    });
  });

  it('returns similar traces for the same root service, operation, and environment', async () => {
    mockClickhouseQuery
      .mockResolvedValueOnce([
        makeSampleSpanRow({
          span_id: 'span-root',
          parent_span_id: '',
          service_name: 'api-gateway',
          environment: 'production',
          operation_name: 'GET /users',
        }),
      ])
      .mockResolvedValueOnce([
        makeSampleTraceSummary({
          trace_id: 'trace-similar',
          root_service: 'api-gateway',
          root_operation: 'GET /users',
          root_environment: 'production',
          duration_ms: 180,
        }),
      ]);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/traces/trace-abc-123/similar?from=2024-01-15T00:00:00Z&to=2024-01-16T00:00:00Z&limit=5',
      headers: { 'x-api-key': 'valid-key' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({
      trace_id: 'trace-similar',
      duration_ms: 180,
      status: 'OK',
      error_count: 0,
    });
    const [queryText, queryParams] = mockClickhouseQuery.mock.calls[1];
    expect(queryText).toContain('root_service = {rootService:String}');
    expect(queryText).toContain('root_operation = {rootOperation:String}');
    expect(queryText).toContain('trace_id != {traceId:String}');
    expect(queryParams).toMatchObject({
      tenantId: 'tenant-1',
      rootService: 'api-gateway',
      rootOperation: 'GET /users',
      environment: 'production',
      traceId: 'trace-abc-123',
      limit: 5,
    });
  });

  it('validates similar trace timestamps and limits before querying ClickHouse', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/traces/trace-abc-123/similar?from=bad&limit=99',
      headers: { 'x-api-key': 'valid-key' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_PARAMETER');
    expect(mockClickhouseQuery).not.toHaveBeenCalled();
  });
});
