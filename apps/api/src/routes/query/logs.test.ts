import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
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

function makeSampleLogRow(overrides: Partial<Record<string, string>> = {}) {
  return {
    id: overrides.id ?? 'log-id-1',
    tenant_id: overrides.tenant_id ?? 'tenant-1',
    project_id: overrides.project_id ?? 'project-1',
    timestamp: overrides.timestamp ?? '2024-01-15T10:30:00.000',
    received_at: overrides.received_at ?? '2024-01-15T10:30:01.000',
    service_name: overrides.service_name ?? 'my-service',
    environment: overrides.environment ?? 'production',
    source: overrides.source ?? '',
    resource_attributes: overrides.resource_attributes ?? '{}',
    attributes: overrides.attributes ?? '{}',
    severity: overrides.severity ?? 'INFO',
    message: overrides.message ?? 'Test log message',
    trace_id: overrides.trace_id ?? '',
    span_id: overrides.span_id ?? '',
    fingerprint: overrides.fingerprint ?? '',
  };
}

describe('GET /v1/logs', () => {
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
        url: '/v1/logs',
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
        url: '/v1/logs',
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
        url: '/v1/logs?from=not-a-date',
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
        url: '/v1/logs?to=invalid-timestamp',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('to');
    });

    it('returns 400 for invalid severity value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/logs?severity=CRITICAL',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('severity');
    });

    it('returns 400 when limit exceeds 1000', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/logs?limit=1001',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('1000');
    });

    it('returns 400 when limit is not a positive integer', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/logs?limit=-5',
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
        url: '/v1/logs?cursor=not-valid-base64-json',
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
        url: '/v1/logs',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toEqual([]);
      expect(body.pagination.cursor).toBeNull();
      expect(body.pagination.hasMore).toBe(false);
    });

    it('returns log records with correct structure', async () => {
      mockClickhouseQuery.mockResolvedValue([makeSampleLogRow()]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/logs',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        id: 'log-id-1',
        tenant_id: 'tenant-1',
        project_id: 'project-1',
        service_name: 'my-service',
        environment: 'production',
        severity: 'INFO',
        message: 'Test log message',
      });
      expect(body.pagination.hasMore).toBe(false);
    });

    it('parses resource_attributes and attributes from JSON strings', async () => {
      mockClickhouseQuery.mockResolvedValue([
        makeSampleLogRow({
          resource_attributes: '{"service.name":"my-service"}',
          attributes: '{"key":"value"}',
        }),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/logs',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data[0].resource_attributes).toEqual({ 'service.name': 'my-service' });
      expect(body.data[0].attributes).toEqual({ key: 'value' });
    });

    it('defaults time range to last 1 hour when not specified', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(mockClickhouseQuery).toHaveBeenCalledTimes(1);
      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('timestamp >= {fromTime:String}');
      expect(queryText).toContain('timestamp <= {toTime:String}');
      expect(queryParams.fromTime).toBeDefined();
      expect(queryParams.toTime).toBeDefined();

      // Verify the time range is approximately 1 hour
      const from = new Date(queryParams.fromTime as string).getTime();
      const to = new Date(queryParams.toTime as string).getTime();
      const diffMs = to - from;
      // Allow some tolerance for test execution time
      expect(diffMs).toBeGreaterThanOrEqual(3500000); // ~58 minutes
      expect(diffMs).toBeLessThanOrEqual(3700000); // ~62 minutes
    });

    it('always includes tenant_id in WHERE clause', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('tenant_id = {tenantId:String}');
      expect(queryParams.tenantId).toBe('tenant-1');
    });

    it('applies service_name filter', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs?service_name=my-service',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('service_name = {serviceName:String}');
      expect(queryParams.serviceName).toBe('my-service');
    });

    it('applies environment filter', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs?environment=production',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('environment = {environment:String}');
      expect(queryParams.environment).toBe('production');
    });

    it('applies severity filter', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs?severity=ERROR',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('severity = {severity:String}');
      expect(queryParams.severity).toBe('ERROR');
    });

    it('applies case-insensitive text search on message', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs?search=error+occurred',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('positionCaseInsensitive(message, {search:String}) > 0');
      expect(queryParams.search).toBe('error occurred');
    });

    it('accepts valid severity values case-insensitively', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/logs?severity=error',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryParams.severity).toBe('ERROR');
    });

    it('uses custom limit when specified', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs?limit=10',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      // fetchLimit should be limit + 1 for hasMore detection
      expect(queryParams.fetchLimit).toBe(11);
    });

    it('uses default limit of 50 when not specified', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryParams.fetchLimit).toBe(51);
    });
  });

  describe('Pagination', () => {
    it('returns hasMore true and cursor when more results exist', async () => {
      // Return limit + 1 rows to indicate more results
      const rows = Array.from({ length: 51 }, (_, i) =>
        makeSampleLogRow({
          id: `log-${i}`,
          timestamp: `2024-01-15T10:${String(30 - i).padStart(2, '0')}:00.000`,
        })
      );
      mockClickhouseQuery.mockResolvedValue(rows);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/logs',
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
      const rows = [makeSampleLogRow()];
      mockClickhouseQuery.mockResolvedValue(rows);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/logs',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.pagination.hasMore).toBe(false);
      expect(body.pagination.cursor).toBeNull();
    });

    it('applies cursor to query when provided', async () => {
      const cursor = Buffer.from(
        JSON.stringify({ ts: '2024-01-15T10:00:00.000', id: 'log-50' })
      ).toString('base64');

      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/v1/logs?cursor=${cursor}`,
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('timestamp < {cursorTs:String}');
      expect(queryText).toContain('id < {cursorId:String}');
      expect(queryParams.cursorTs).toBe('2024-01-15T10:00:00.000');
      expect(queryParams.cursorId).toBe('log-50');
    });
  });

  describe('Query structure', () => {
    it('orders results by timestamp DESC, id DESC', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('ORDER BY timestamp DESC, id DESC');
    });

    it('applies time range filter with from and to parameters', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/logs?from=2024-01-15T00:00:00Z&to=2024-01-15T23:59:59Z',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryParams.fromTime).toBe('2024-01-15T00:00:00.000Z');
      expect(queryParams.toTime).toBe('2024-01-15T23:59:59.000Z');
    });
  });
});
