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

function makeSampleDeploymentRow(overrides: Partial<Record<string, string>> = {}) {
  return {
    deployment_id: overrides.deployment_id ?? 'deploy-1',
    tenant_id: overrides.tenant_id ?? 'tenant-1',
    project_id: overrides.project_id ?? 'project-1',
    timestamp: overrides.timestamp ?? '2024-01-15T10:30:00.000',
    service_name: overrides.service_name ?? 'api-gateway',
    environment: overrides.environment ?? 'production',
    version: overrides.version ?? 'v1.2.3',
    git_sha: overrides.git_sha ?? 'abc123',
    deployed_by: overrides.deployed_by ?? 'ci-bot',
    provider: overrides.provider ?? 'github-actions',
    metadata: overrides.metadata ?? '{"branch":"main"}',
  };
}

describe('GET /v1/deployments', () => {
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
        url: '/v1/deployments',
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
        url: '/v1/deployments',
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
        url: '/v1/deployments?from=not-a-date',
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
        url: '/v1/deployments?to=invalid-timestamp',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('to');
    });

    it('returns 400 when limit exceeds 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/deployments?limit=201',
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
        url: '/v1/deployments?limit=-5',
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
        url: '/v1/deployments?cursor=not-valid-base64-json',
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
        url: '/v1/deployments',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toEqual([]);
      expect(body.pagination.cursor).toBeNull();
      expect(body.pagination.hasMore).toBe(false);
    });

    it('returns deployment events with correct structure', async () => {
      mockClickhouseQuery.mockResolvedValue([makeSampleDeploymentRow()]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/deployments',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        deployment_id: 'deploy-1',
        tenant_id: 'tenant-1',
        project_id: 'project-1',
        service_name: 'api-gateway',
        environment: 'production',
        version: 'v1.2.3',
        git_sha: 'abc123',
        deployed_by: 'ci-bot',
        provider: 'github-actions',
      });
      expect(body.data[0].metadata).toEqual({ branch: 'main' });
      expect(body.pagination.hasMore).toBe(false);
    });

    it('always includes tenant_id in WHERE clause', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/deployments',
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
        url: '/v1/deployments?service=api-gateway',
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
        url: '/v1/deployments?environment=production',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('environment = {environment:String}');
      expect(queryParams.environment).toBe('production');
    });

    it('applies time range filters', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/deployments?from=2024-01-01T00:00:00Z&to=2024-01-31T23:59:59Z',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('timestamp >= {from:String}');
      expect(queryText).toContain('timestamp <= {to:String}');
      expect(queryParams.from).toBe('2024-01-01T00:00:00Z');
      expect(queryParams.to).toBe('2024-01-31T23:59:59Z');
    });

    it('uses default limit of 50', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/deployments',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryParams.fetchLimit).toBe(51);
    });

    it('uses custom limit when specified', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/deployments?limit=10',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryParams.fetchLimit).toBe(11);
    });

    it('orders results by timestamp DESC, deployment_id DESC', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/deployments',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('ORDER BY timestamp DESC, deployment_id DESC');
    });

    it('handles invalid metadata JSON gracefully', async () => {
      mockClickhouseQuery.mockResolvedValue([
        makeSampleDeploymentRow({ metadata: 'not-valid-json' }),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/deployments',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data[0].metadata).toEqual({});
    });
  });

  describe('Pagination', () => {
    it('returns hasMore true and cursor when more results exist', async () => {
      const rows = Array.from({ length: 51 }, (_, i) =>
        makeSampleDeploymentRow({
          deployment_id: `deploy-${i}`,
          timestamp: `2024-01-15T10:${String(30 - Math.floor(i / 2)).padStart(2, '0')}:00.000`,
        })
      );
      mockClickhouseQuery.mockResolvedValue(rows);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/deployments',
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
      const rows = [makeSampleDeploymentRow()];
      mockClickhouseQuery.mockResolvedValue(rows);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/deployments',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.pagination.hasMore).toBe(false);
      expect(body.pagination.cursor).toBeNull();
    });

    it('applies cursor to query when provided', async () => {
      const cursor = Buffer.from(
        JSON.stringify({ ts: '2024-01-15T10:00:00.000', id: 'deploy-50' })
      ).toString('base64');

      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/v1/deployments?cursor=${cursor}`,
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('timestamp < {cursorTs:String}');
      expect(queryText).toContain('deployment_id < {cursorId:String}');
      expect(queryParams.cursorTs).toBe('2024-01-15T10:00:00.000');
      expect(queryParams.cursorId).toBe('deploy-50');
    });
  });
});
