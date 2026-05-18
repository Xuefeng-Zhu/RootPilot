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

function validMetricPayload() {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'my-service' } },
            { key: 'deployment.environment', value: { stringValue: 'production' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'test-scope' },
            metrics: [
              {
                name: 'http.request.duration',
                unit: 'ms',
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: '1700000000000000000',
                      asDouble: 42.5,
                      attributes: [{ key: 'method', value: { stringValue: 'GET' } }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('POST /v1/ingest/metrics', () => {
  let app: FastifyInstance;
  let mockBatchInsert: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockBatchInsert = vi.fn().mockResolvedValue(undefined);
    mockGetClickHouseClient.mockReturnValue({
      batchInsert: mockBatchInsert,
      query: vi.fn(),
      healthCheck: vi.fn(),
      close: vi.fn(),
    } as any);
    mockValidAuth();
  });

  describe('Authentication', () => {
    it('returns 401 when X-API-Key header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json' },
        payload: validMetricPayload(),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 when X-API-Key header is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': '' },
        payload: validMetricPayload(),
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
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'invalid-key' },
        payload: validMetricPayload(),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_INVALID');
    });
  });

  describe('Payload validation', () => {
    it('returns 400 when body is missing resourceMetrics', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { someField: 'value' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message.length).toBeGreaterThanOrEqual(10);
    });

    it('returns 400 when resourceMetrics is not an array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { resourceMetrics: 'not-an-array' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('returns 400 when resourceMetrics is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { resourceMetrics: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('returns 400 when scopeMetrics is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          resourceMetrics: [{ resource: { attributes: [] } }],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
      expect(response.json().error.message).toContain('scopeMetrics');
    });

    it('returns 400 when metrics array is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          resourceMetrics: [
            {
              resource: { attributes: [] },
              scopeMetrics: [{ scope: { name: 'test' } }],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
      expect(response.json().error.message).toContain('metrics');
    });

    it('returns 400 when metric has no name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          resourceMetrics: [
            {
              resource: { attributes: [] },
              scopeMetrics: [
                {
                  metrics: [{ gauge: { dataPoints: [{ asDouble: 1.0 }] } }],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
      expect(response.json().error.message).toContain('name');
    });

    it('returns 400 when metric has no data container (gauge/sum/histogram)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          resourceMetrics: [
            {
              resource: { attributes: [] },
              scopeMetrics: [
                {
                  metrics: [{ name: 'cpu.usage' }],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
      expect(response.json().error.message).toContain('gauge');
    });

    it('returns 400 when gauge data point has non-numeric value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          resourceMetrics: [
            {
              resource: { attributes: [] },
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: 'cpu.usage',
                      gauge: {
                        dataPoints: [{ asDouble: 'not-a-number' }],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
      expect(response.json().error.message).toContain('numeric');
    });

    it('returns 400 when sum data point has no numeric value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          resourceMetrics: [
            {
              resource: { attributes: [] },
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: 'request.count',
                      sum: {
                        dataPoints: [{ timeUnixNano: '1700000000000000000' }],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
      expect(response.json().error.message).toContain('numeric');
    });

    it('returns 400 when histogram data point has no sum value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          resourceMetrics: [
            {
              resource: { attributes: [] },
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: 'request.duration',
                      histogram: {
                        dataPoints: [{ count: 10 }],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
      expect(response.json().error.message).toContain('numeric');
    });

    it('returns error message with at least 10 characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Successful ingestion', () => {
    it('returns 202 on valid gauge metric payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validMetricPayload(),
      });

      expect(response.statusCode).toBe(202);
    });

    it('returns 202 on valid sum metric payload', async () => {
      const payload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'my-service' } }],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'http.request.count',
                    sum: {
                      dataPoints: [{ timeUnixNano: '1700000000000000000', asInt: 100 }],
                      isMonotonic: true,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload,
      });

      expect(response.statusCode).toBe(202);
    });

    it('returns 202 on valid histogram metric payload', async () => {
      const payload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'my-service' } }],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'http.request.duration',
                    histogram: {
                      dataPoints: [
                        {
                          timeUnixNano: '1700000000000000000',
                          sum: 1500.5,
                          count: 10,
                          min: 50,
                          max: 300,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload,
      });

      expect(response.statusCode).toBe(202);
    });

    it('calls batchInsert with normalized metric records', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validMetricPayload(),
      });

      expect(mockBatchInsert).toHaveBeenCalledTimes(1);
      const [table, rows] = mockBatchInsert.mock.calls[0];
      expect(table).toBe('metrics');
      expect(rows).toHaveLength(1);

      // Verify canonical fields are present
      const firstRow = rows[0];
      expect(firstRow.tenant_id).toBe('tenant-1');
      expect(firstRow.project_id).toBe('project-1');
      expect(firstRow.service_name).toBe('my-service');
      expect(firstRow.environment).toBe('production');
      expect(firstRow.metric_name).toBe('http.request.duration');
      expect(firstRow.metric_type).toBe('gauge');
      expect(firstRow.value).toBe(42.5);
      expect(firstRow.unit).toBe('ms');
      expect(firstRow.id).toBeDefined();
      expect(firstRow.timestamp).toBeDefined();
      expect(firstRow.received_at).toBeDefined();
    });

    it('serializes resource_attributes, attributes, and labels as JSON strings', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validMetricPayload(),
      });

      const [, rows] = mockBatchInsert.mock.calls[0];
      const firstRow = rows[0];
      expect(typeof firstRow.resource_attributes).toBe('string');
      expect(typeof firstRow.attributes).toBe('string');
      expect(typeof firstRow.labels).toBe('string');
      expect(JSON.parse(firstRow.resource_attributes)).toHaveProperty('service.name');
      expect(JSON.parse(firstRow.labels)).toHaveProperty('method', 'GET');
    });

    it('handles multiple metrics across multiple scopeMetrics', async () => {
      const payload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'svc-a' } }],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'metric.one',
                    gauge: { dataPoints: [{ asDouble: 1.0 }] },
                  },
                  {
                    name: 'metric.two',
                    gauge: { dataPoints: [{ asDouble: 2.0 }] },
                  },
                ],
              },
              {
                metrics: [
                  {
                    name: 'metric.three',
                    sum: { dataPoints: [{ asInt: 3 }] },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload,
      });

      expect(response.statusCode).toBe(202);
      const [, rows] = mockBatchInsert.mock.calls[0];
      expect(rows).toHaveLength(3);
    });

    it('handles multiple data points per metric', async () => {
      const payload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'my-service' } }],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'cpu.usage',
                    gauge: {
                      dataPoints: [
                        { timeUnixNano: '1700000000000000000', asDouble: 45.2 },
                        { timeUnixNano: '1700000001000000000', asDouble: 47.8 },
                        { timeUnixNano: '1700000002000000000', asDouble: 50.1 },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/metrics',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload,
      });

      expect(response.statusCode).toBe(202);
      const [, rows] = mockBatchInsert.mock.calls[0];
      expect(rows).toHaveLength(3);
    });
  });
});
