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

describe('GET /v1/services', () => {
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
        url: '/v1/services',
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
        url: '/v1/services',
        headers: { 'x-api-key': 'invalid-key' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_INVALID');
    });
  });

  describe('Successful queries', () => {
    it('returns empty data array with 200 when no services found', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/services',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toEqual([]);
    });

    it('returns aggregated service entries with correct structure', async () => {
      mockClickhouseQuery.mockResolvedValue([
        {
          service_name: 'api-gateway',
          environment: 'production',
          last_seen: '2024-01-15T10:30:00.000',
          log_count: '150',
          span_count: '300',
          metric_count: '50',
        },
        {
          service_name: 'user-service',
          environment: 'staging',
          last_seen: '2024-01-15T09:00:00.000',
          log_count: '75',
          span_count: '100',
          metric_count: '25',
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/services',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0]).toEqual({
        service_name: 'api-gateway',
        environment: 'production',
        last_seen: '2024-01-15T10:30:00.000',
        log_count: 150,
        span_count: 300,
        metric_count: 50,
      });
      expect(body.data[1]).toEqual({
        service_name: 'user-service',
        environment: 'staging',
        last_seen: '2024-01-15T09:00:00.000',
        log_count: 75,
        span_count: 100,
        metric_count: 25,
      });
    });

    it('converts string counts to numbers', async () => {
      mockClickhouseQuery.mockResolvedValue([
        {
          service_name: 'test-service',
          environment: 'dev',
          last_seen: '2024-01-15T10:00:00.000',
          log_count: '0',
          span_count: '0',
          metric_count: '10',
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/services',
        headers: { 'x-api-key': 'valid-key' },
      });

      const body = response.json();
      expect(typeof body.data[0].log_count).toBe('number');
      expect(typeof body.data[0].span_count).toBe('number');
      expect(typeof body.data[0].metric_count).toBe('number');
    });

    it('always includes tenant_id in WHERE clause', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/services',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('tenant_id = {tenantId:String}');
      expect(queryParams.tenantId).toBe('tenant-1');
    });

    it('aggregates across logs, spans, and metrics tables', async () => {
      mockClickhouseQuery.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/v1/services',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockClickhouseQuery.mock.calls[0];
      expect(queryText).toContain('FROM logs');
      expect(queryText).toContain('FROM spans');
      expect(queryText).toContain('FROM metrics');
      expect(queryText).toContain('UNION ALL');
    });
  });
});
