import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server.js';

// Mock the postgres module for auth
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
function setupAuthMock() {
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

/**
 * Creates a valid minimal trace ingestion payload.
 */
function validTracePayload() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'test-service' } }],
        },
        scopeSpans: [
          {
            scope: { name: 'test-scope' },
            spans: [
              {
                traceId: 'abc123def456',
                spanId: 'span001',
                name: 'GET /api/users',
                startTimeUnixNano: '1700000000000000000',
                endTimeUnixNano: '1700000000100000000',
                kind: 2,
                status: { code: 0 },
                attributes: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('POST /v1/ingest/traces', () => {
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
    setupAuthMock();
  });

  describe('Authentication', () => {
    it('returns 401 when X-API-Key header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: { 'content-type': 'application/json' },
        payload: validTracePayload(),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('Payload validation', () => {
    it('returns 400 when body is missing resourceSpans', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message.length).toBeGreaterThanOrEqual(10);
      expect(body.error.message).toContain('resourceSpans');
    });

    it('returns 400 when resourceSpans is not an array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: { resourceSpans: 'not-an-array' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('returns 400 when resourceSpans is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: { resourceSpans: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('returns 400 when scopeSpans is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: {
          resourceSpans: [{ resource: {} }],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('scopeSpans');
    });

    it('returns 400 when spans array is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: {
          resourceSpans: [
            {
              scopeSpans: [{ spans: [] }],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('at least one span');
    });

    it('returns 400 when span is missing traceId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: {
          resourceSpans: [
            {
              scopeSpans: [
                {
                  spans: [
                    {
                      spanId: 'span1',
                      name: 'test',
                      startTimeUnixNano: '1700000000000000000',
                      endTimeUnixNano: '1700000000100000000',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('traceId');
    });

    it('returns 400 when span is missing spanId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: {
          resourceSpans: [
            {
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId: 'trace1',
                      name: 'test',
                      startTimeUnixNano: '1700000000000000000',
                      endTimeUnixNano: '1700000000100000000',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('spanId');
    });

    it('returns 400 when span is missing name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: {
          resourceSpans: [
            {
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId: 'trace1',
                      spanId: 'span1',
                      startTimeUnixNano: '1700000000000000000',
                      endTimeUnixNano: '1700000000100000000',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('name');
    });

    it('returns 400 when span is missing startTimeUnixNano', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: {
          resourceSpans: [
            {
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId: 'trace1',
                      spanId: 'span1',
                      name: 'test',
                      endTimeUnixNano: '1700000000100000000',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('startTimeUnixNano');
    });

    it('returns 400 when span is missing endTimeUnixNano', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: {
          resourceSpans: [
            {
              scopeSpans: [
                {
                  spans: [
                    {
                      traceId: 'trace1',
                      spanId: 'span1',
                      name: 'test',
                      startTimeUnixNano: '1700000000000000000',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('endTimeUnixNano');
    });
  });

  describe('Span kind validation', () => {
    it('returns 400 when span kind is invalid (> 5)', async () => {
      const payload = validTracePayload();
      payload.resourceSpans[0].scopeSpans[0].spans[0].kind = 6;

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('kind');
      expect(body.error.message.length).toBeGreaterThanOrEqual(10);
    });

    it('returns 400 when span kind is negative', async () => {
      const payload = validTracePayload();
      payload.resourceSpans[0].scopeSpans[0].spans[0].kind = -1;

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('accepts valid span kind values (0-5)', async () => {
      for (const kind of [0, 1, 2, 3, 4, 5]) {
        const payload = validTracePayload();
        payload.resourceSpans[0].scopeSpans[0].spans[0].kind = kind;

        const response = await app.inject({
          method: 'POST',
          url: '/v1/ingest/traces',
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'valid-key',
          },
          payload,
        });

        expect(response.statusCode).toBe(202);
      }
    });
  });

  describe('Status code validation', () => {
    it('returns 400 when status code is invalid (> 2)', async () => {
      const payload = validTracePayload();
      payload.resourceSpans[0].scopeSpans[0].spans[0].status = { code: 3 };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('status code');
      expect(body.error.message.length).toBeGreaterThanOrEqual(10);
    });

    it('returns 400 when status code is negative', async () => {
      const payload = validTracePayload();
      payload.resourceSpans[0].scopeSpans[0].spans[0].status = { code: -1 };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('accepts valid status code values (0-2)', async () => {
      for (const code of [0, 1, 2]) {
        const payload = validTracePayload();
        payload.resourceSpans[0].scopeSpans[0].spans[0].status = { code };

        const response = await app.inject({
          method: 'POST',
          url: '/v1/ingest/traces',
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'valid-key',
          },
          payload,
        });

        expect(response.statusCode).toBe(202);
      }
    });
  });

  describe('Successful ingestion', () => {
    it('returns 202 on valid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: validTracePayload(),
      });

      expect(response.statusCode).toBe(202);
    });

    it('calls normalizeSpans and inserts into ClickHouse', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload: validTracePayload(),
      });

      expect(response.statusCode).toBe(202);
      expect(mockBatchInsert).toHaveBeenCalledTimes(1);
      expect(mockBatchInsert).toHaveBeenCalledWith(
        'spans',
        expect.arrayContaining([
          expect.objectContaining({
            tenant_id: 'tenant-1',
            project_id: 'project-1',
            trace_id: 'abc123def456',
            span_id: 'span001',
            operation_name: 'GET /api/users',
          }),
        ]),
      );
    });

    it('handles multiple spans across multiple scopeSpans', async () => {
      const payload = {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'svc-a' } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'trace1',
                    spanId: 'span1',
                    name: 'op1',
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000000050000000',
                    kind: 2,
                  },
                  {
                    traceId: 'trace1',
                    spanId: 'span2',
                    parentSpanId: 'span1',
                    name: 'op2',
                    startTimeUnixNano: '1700000000010000000',
                    endTimeUnixNano: '1700000000040000000',
                    kind: 3,
                  },
                ],
              },
              {
                spans: [
                  {
                    traceId: 'trace1',
                    spanId: 'span3',
                    parentSpanId: 'span1',
                    name: 'op3',
                    startTimeUnixNano: '1700000000020000000',
                    endTimeUnixNano: '1700000000045000000',
                    kind: 4,
                    status: { code: 2, message: 'timeout' },
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      expect(mockBatchInsert).toHaveBeenCalledTimes(1);
      const insertedRows = mockBatchInsert.mock.calls[0][1];
      expect(insertedRows).toHaveLength(3);
    });

    it('accepts spans without kind (defaults to INTERNAL)', async () => {
      const payload = {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'trace1',
                    spanId: 'span1',
                    name: 'test-op',
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000000100000000',
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      const insertedRows = mockBatchInsert.mock.calls[0][1];
      expect(insertedRows[0].kind).toBe('INTERNAL');
    });

    it('accepts spans without status (defaults to UNSET)', async () => {
      const payload = {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'trace1',
                    spanId: 'span1',
                    name: 'test-op',
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000000100000000',
                    kind: 1,
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/traces',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid-key',
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      const insertedRows = mockBatchInsert.mock.calls[0][1];
      expect(insertedRows[0].status_code).toBe('UNSET');
    });
  });
});
