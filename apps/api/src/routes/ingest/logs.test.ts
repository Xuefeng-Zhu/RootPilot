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

function validLogPayload(logRecordCount = 1) {
  const logRecords = Array.from({ length: logRecordCount }, (_, i) => ({
    timeUnixNano: '1700000000000000000',
    severityNumber: 9,
    body: { stringValue: `Test log message ${i}` },
    attributes: [{ key: 'app', value: { stringValue: 'test-app' } }],
  }));

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'my-service' } },
            { key: 'deployment.environment', value: { stringValue: 'production' } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: 'test-scope' },
            logRecords,
          },
        ],
      },
    ],
  };
}

describe('POST /v1/ingest/logs', () => {
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
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json' },
        payload: validLogPayload(),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 when X-API-Key header is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': '' },
        payload: validLogPayload(),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('Payload validation', () => {
    it('returns 400 when body is missing resourceLogs', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { someField: 'value' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message.length).toBeGreaterThanOrEqual(10);
    });

    it('returns 400 when resourceLogs is not an array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { resourceLogs: 'not-an-array' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('returns 400 when no logRecords exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          resourceLogs: [
            {
              resource: { attributes: [] },
              scopeLogs: [{ logRecords: [] }],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('logRecord');
    });

    it('returns 400 when logRecords exceed 1000', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validLogPayload(1001),
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('RECORD_LIMIT_EXCEEDED');
      expect(body.error.message).toContain('1001');
      expect(body.error.message).toContain('1000');
    });

    it('returns 413 when payload exceeds 5 MB body limit', async () => {
      // Create a payload slightly over 5 MB
      const largePayload = JSON.stringify({
        resourceLogs: [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                logRecords: [
                  {
                    body: { stringValue: 'x'.repeat(5 * 1024 * 1024) },
                  },
                ],
              },
            ],
          },
        ],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        body: largePayload,
      });

      // Fastify enforces body limit at framework level, returning 413
      expect(response.statusCode).toBe(413);
    });
  });

  describe('Successful ingestion', () => {
    it('returns 202 on valid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validLogPayload(),
      });

      expect(response.statusCode).toBe(202);
    });

    it('calls batchInsert with normalized log records', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validLogPayload(3),
      });

      expect(mockBatchInsert).toHaveBeenCalledTimes(1);
      const [table, rows] = mockBatchInsert.mock.calls[0];
      expect(table).toBe('logs');
      expect(rows).toHaveLength(3);

      // Verify canonical fields are present
      const firstRow = rows[0];
      expect(firstRow.tenant_id).toBe('tenant-1');
      expect(firstRow.project_id).toBe('project-1');
      expect(firstRow.service_name).toBe('my-service');
      expect(firstRow.environment).toBe('production');
      expect(firstRow.severity).toBe('INFO');
      expect(firstRow.id).toBeDefined();
      expect(firstRow.timestamp).toBeDefined();
      expect(firstRow.received_at).toBeDefined();
    });

    it('serializes resource_attributes and attributes as JSON strings', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validLogPayload(),
      });

      const [, rows] = mockBatchInsert.mock.calls[0];
      const firstRow = rows[0];
      expect(typeof firstRow.resource_attributes).toBe('string');
      expect(typeof firstRow.attributes).toBe('string');
      expect(JSON.parse(firstRow.resource_attributes)).toHaveProperty('service.name');
    });

    it('handles multiple resourceLogs with multiple scopeLogs', async () => {
      const payload = {
        resourceLogs: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'svc-a' } }],
            },
            scopeLogs: [
              { logRecords: [{ body: { stringValue: 'log 1' } }] },
              { logRecords: [{ body: { stringValue: 'log 2' } }] },
            ],
          },
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'svc-b' } }],
            },
            scopeLogs: [
              { logRecords: [{ body: { stringValue: 'log 3' } }] },
            ],
          },
        ],
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload,
      });

      expect(response.statusCode).toBe(202);
      const [, rows] = mockBatchInsert.mock.calls[0];
      expect(rows).toHaveLength(3);
    });

    it('accepts exactly 1000 logRecords', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/ingest/logs',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validLogPayload(1000),
      });

      expect(response.statusCode).toBe(202);
    });
  });
});
