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
    duration_ms: (overrides.duration_ms as number) ?? 150.5,
    span_count: (overrides.span_count as number) ?? 5,
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
      expect(queryText).toContain('timestamp >= {fromTime:DateTime64(3)}');
      expect(queryText).toContain('timestamp <= {toTime:DateTime64(3)}');
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

    it('applies time range filter with from and to parameters', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/traces?from=2024-01-15T00:00:00Z&to=2024-01-15T23:59:59Z',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryParams.fromTime).toBe('2024-01-15 00:00:00.000');
      expect(queryParams.toTime).toBe('2024-01-15 23:59:59.000');
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
      expect(queryParams.cursorTs).toBe('2024-01-15 10:00:00.000');
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
