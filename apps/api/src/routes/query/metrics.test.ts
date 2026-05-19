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
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
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

describe('GET /v1/metrics', () => {
  let app: FastifyInstance;
  let mockChQuery: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockChQuery = vi.fn().mockResolvedValue([]);
    mockGetClickHouseClient.mockReturnValue({
      batchInsert: vi.fn().mockResolvedValue(undefined),
      query: mockChQuery,
      healthCheck: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
    } as any);
    mockValidAuth();
  });

  describe('Authentication', () => {
    it('returns 401 when X-API-Key header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 when API key is invalid', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('api_keys')) {
          return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
        }
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } as any;
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics',
        headers: { 'x-api-key': 'invalid-key' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_INVALID');
    });
  });

  describe('Parameter validation', () => {
    it('returns 400 for unsupported interval value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics?interval=2m',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('interval');
      expect(body.error.message).toContain('2m');
    });

    it('returns 400 for unsupported aggregation value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics?aggregation=median',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('aggregation');
      expect(body.error.message).toContain('median');
    });

    it('returns 400 for invalid from timestamp', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics?from=not-a-date',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('from');
    });

    it('returns 400 for invalid to timestamp', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics?to=invalid-timestamp',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PARAMETER');
      expect(body.error.message).toContain('to');
    });

    it('accepts all valid interval values', async () => {
      const validIntervals = ['1m', '5m', '15m', '1h', '1d'];
      for (const interval of validIntervals) {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/metrics?interval=${interval}`,
          headers: { 'x-api-key': 'valid-key' },
        });
        expect(response.statusCode).toBe(200);
      }
    });

    it('accepts all valid aggregation values', async () => {
      const validAggregations = ['avg', 'sum', 'min', 'max', 'count'];
      for (const aggregation of validAggregations) {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/metrics?aggregation=${aggregation}`,
          headers: { 'x-api-key': 'valid-key' },
        });
        expect(response.statusCode).toBe(200);
      }
    });
  });

  describe('Response shape', () => {
    it('returns correct response structure with no data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics?metric_name=cpu.usage',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('metric_name', 'cpu.usage');
      expect(body).toHaveProperty('aggregation', 'avg');
      expect(body).toHaveProperty('interval', null);
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(0);
    });

    it('returns interval in response when specified', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics?interval=5m',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.interval).toBe('5m');
    });

    it('returns aggregation in response when specified', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics?aggregation=sum',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.aggregation).toBe('sum');
    });

    it('defaults aggregation to avg when not specified', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.aggregation).toBe('avg');
    });

    it('returns data points with timestamp and value', async () => {
      mockChQuery.mockResolvedValue([
        { timestamp: '2024-01-15 10:00:00.000', value: 42.5 },
        { timestamp: '2024-01-15 10:01:00.000', value: 45.2 },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics?metric_name=cpu.usage',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0]).toHaveProperty('timestamp');
      expect(body.data[0]).toHaveProperty('value', 42.5);
      expect(body.data[1]).toHaveProperty('value', 45.2);
    });
  });

  describe('Query behavior', () => {
    it('includes tenant_id in the query', async () => {
      await app.inject({
        method: 'GET',
        url: '/v1/metrics',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(mockChQuery).toHaveBeenCalledTimes(1);
      const [queryText, queryParams] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('tenant_id');
      expect(queryParams.tenantId).toBe('tenant-1');
    });

    it('defaults time range to last 1 hour when not specified', async () => {
      await app.inject({
        method: 'GET',
        url: '/v1/metrics',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(mockChQuery).toHaveBeenCalledTimes(1);
      const [, queryParams] = mockChQuery.mock.calls[0];
      // fromTime should be approximately 1 hour ago
      const fromTime = new Date(queryParams.fromTime.replace(' ', 'T') + 'Z');
      const now = new Date();
      const diffMs = now.getTime() - fromTime.getTime();
      // Should be approximately 1 hour (3600000ms), allow 5 second tolerance
      expect(diffMs).toBeGreaterThan(3595000);
      expect(diffMs).toBeLessThan(3605000);
    });

    it('applies metric_name filter', async () => {
      await app.inject({
        method: 'GET',
        url: '/v1/metrics?metric_name=cpu.usage',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('metric_name');
      expect(queryParams.metricName).toBe('cpu.usage');
    });

    it('applies service filter', async () => {
      await app.inject({
        method: 'GET',
        url: '/v1/metrics?service=my-service',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('service_name');
      expect(queryParams.serviceName).toBe('my-service');
    });

    it('applies environment filter', async () => {
      await app.inject({
        method: 'GET',
        url: '/v1/metrics?environment=production',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('environment');
      expect(queryParams.environment).toBe('production');
    });

    it('applies time range filters', async () => {
      const from = '2024-01-15T10:00:00Z';
      const to = '2024-01-15T11:00:00Z';

      await app.inject({
        method: 'GET',
        url: `/v1/metrics?from=${from}&to=${to}`,
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('timestamp >=');
      expect(queryText).toContain('timestamp <=');
      expect(queryParams.fromTime).toBeDefined();
      expect(queryParams.toTime).toBeDefined();
    });

    it('uses raw query without interval (LIMIT 1000, ORDER BY timestamp ASC)', async () => {
      await app.inject({
        method: 'GET',
        url: '/v1/metrics',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('LIMIT 1000');
      expect(queryText).toContain('ORDER BY timestamp ASC');
      expect(queryText).not.toContain('toStartOfInterval');
      expect(queryText).not.toContain('GROUP BY');
    });

    it('uses aggregated query with interval', async () => {
      await app.inject({
        method: 'GET',
        url: '/v1/metrics?interval=5m&aggregation=sum',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('toStartOfInterval');
      expect(queryText).toContain('INTERVAL 5 MINUTE');
      expect(queryText).toContain('sum(value)');
      expect(queryText).toContain('GROUP BY');
      expect(queryText).toContain('ORDER BY point_timestamp ASC');
    });

    it('uses avg aggregation by default with interval', async () => {
      await app.inject({
        method: 'GET',
        url: '/v1/metrics?interval=1h',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('avg(value)');
    });

    it('applies all filters together', async () => {
      await app.inject({
        method: 'GET',
        url: '/v1/metrics?metric_name=cpu.usage&service=api&environment=prod&interval=1m&aggregation=max',
        headers: { 'x-api-key': 'valid-key' },
      });

      const [queryText, queryParams] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('metric_name');
      expect(queryText).toContain('service_name');
      expect(queryText).toContain('environment');
      expect(queryText).toContain('toStartOfInterval');
      expect(queryText).toContain('max(value)');
      expect(queryParams.metricName).toBe('cpu.usage');
      expect(queryParams.serviceName).toBe('api');
      expect(queryParams.environment).toBe('prod');
    });
  });

  describe('Explorer endpoints', () => {
    it('returns catalog entries with metric metadata', async () => {
      mockChQuery.mockResolvedValueOnce([
        {
          metric_name: 'http.server.request.duration',
          metric_type: 'gauge',
          unit: 'ms',
          services: ['checkout-service', 'api-gateway'],
          last_seen: '2026-05-18 12:00:00.000',
          sample_count: '42',
          label_keys: ['route', 'status_code'],
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics/catalog',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const [queryText, queryParams] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('tenant_id = {tenantId:String}');
      expect(queryText).toContain('JSONExtractKeys(labels)');
      expect(queryParams.tenantId).toBe('tenant-1');
      expect(response.json().data[0]).toMatchObject({
        metric_name: 'http.server.request.duration',
        unit: 'ms',
        sample_count: 42,
        label_keys: ['route', 'status_code'],
      });
    });

    it('returns metric detail with description and example labels', async () => {
      mockChQuery.mockResolvedValueOnce([
        {
          metric_name: 'checkout.error_rate',
          metric_type: 'gauge',
          unit: 'percent',
          services: ['checkout-service'],
          last_seen: '2026-05-18 12:00:00.000',
          sample_count: '3',
          label_keys: ['route'],
          latest_value: '0.24',
          example_labels: JSON.stringify({ route: '/api/checkout' }),
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics/checkout.error_rate',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        metric_name: 'checkout.error_rate',
        unit: 'percent',
        latest_value: 0.24,
        example_labels: { route: '/api/checkout' },
      });
    });

    it('validates malformed labels before querying explorer series', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics/http.server.request.duration/series?labels=not-json',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('labels');
      expect(mockChQuery).not.toHaveBeenCalled();
    });

    it('validates unsafe group_by before querying explorer series', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics/http.server.request.duration/series?group_by=bad%20label',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('group_by');
      expect(mockChQuery).not.toHaveBeenCalled();
    });

    it('returns grouped metric series with percentile aggregation and comparison', async () => {
      mockChQuery
        .mockResolvedValueOnce([{ unit: 'ms' }])
        .mockResolvedValueOnce([
          {
            timestamp: '2026-05-18T12:00:00.000',
            series_name: 'checkout-service',
            value: '231',
          },
        ])
        .mockResolvedValueOnce([
          {
            current_avg: '200',
            previous_avg: '100',
            current_max: '300',
            previous_max: '150',
            current_p95: '250',
            previous_p95: '100',
            current_count: '10',
            previous_count: '8',
          },
        ]);

      const labels = encodeURIComponent(JSON.stringify({ route: '/api/checkout' }));
      const response = await app.inject({
        method: 'GET',
        url: `/v1/metrics/http.server.request.duration/series?aggregation=p95&interval=5m&group_by=service_name&service=checkout-service&labels=${labels}`,
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const [, seriesParams] = mockChQuery.mock.calls[1];
      const [seriesSql] = mockChQuery.mock.calls[1];
      expect(seriesSql).toContain('quantile(0.95)(value)');
      expect(seriesSql).toContain('GROUP BY point_timestamp, series_name');
      expect(seriesParams.metricName).toBe('http.server.request.duration');
      expect(seriesParams.serviceName).toBe('checkout-service');
      expect(seriesParams.labelKey0).toBe('route');
      expect(response.json()).toMatchObject({
        metric_name: 'http.server.request.duration',
        unit: 'ms',
        aggregation: 'p95',
        interval: '5m',
        series: [{ name: 'checkout-service' }],
        comparison: { status: 'Large increase' },
      });
    });

    it('returns top services ranked by metric type', async () => {
      mockChQuery
        .mockResolvedValueOnce([
          {
            service_name: 'checkout-service',
            latest_value: '210',
            average: '120',
            p95: '240',
            max: '300',
            last_seen: '2026-05-18 12:00:00.000',
          },
        ])
        .mockResolvedValueOnce([{ unit: 'ms' }]);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/metrics/http.server.request.duration/top-services?from=2026-05-18T11:00:00Z&to=2026-05-18T12:00:00Z',
        headers: { 'x-api-key': 'valid-key' },
      });

      expect(response.statusCode).toBe(200);
      const [queryText, queryParams] = mockChQuery.mock.calls[0];
      expect(queryText).toContain('ORDER BY p95 DESC');
      expect(queryParams.tenantId).toBe('tenant-1');
      expect(response.json().data[0]).toMatchObject({
        service_name: 'checkout-service',
        latest_value: 210,
        p95: 240,
      });
    });
  });
});
