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

function validDeploymentPayload() {
  return {
    service_name: 'payment-service',
    environment: 'production',
    version: '1.2.3',
  };
}

describe('POST /v1/events/deployments', () => {
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
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json' },
        payload: validDeploymentPayload(),
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
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'invalid-key' },
        payload: validDeploymentPayload(),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('AUTH_INVALID');
    });
  });

  describe('Payload validation', () => {
    it('returns 400 when body is not a JSON object', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: '"just a string"',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message.length).toBeGreaterThanOrEqual(10);
    });

    it('returns 400 when service_name is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { environment: 'production', version: '1.0.0' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('service_name');
    });

    it('returns 400 when environment is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { service_name: 'my-service', version: '1.0.0' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('environment');
    });

    it('returns 400 when version is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { service_name: 'my-service', environment: 'production' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('version');
    });

    it('returns 400 when service_name is empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { service_name: '', environment: 'production', version: '1.0.0' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('returns 400 when service_name is whitespace only', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { service_name: '   ', environment: 'production', version: '1.0.0' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('returns 400 when multiple required fields are missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('service_name');
      expect(body.error.message).toContain('environment');
      expect(body.error.message).toContain('version');
    });

    it('returns 400 when timestamp is invalid ISO 8601', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          ...validDeploymentPayload(),
          timestamp: 'not-a-date',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.message).toContain('timestamp');
    });

    it('returns error message with at least 10 characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.message.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Successful ingestion', () => {
    it('returns 202 on valid minimal payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validDeploymentPayload(),
      });

      expect(response.statusCode).toBe(202);
    });

    it('returns 202 on valid full payload with all optional fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          deployment_id: '550e8400-e29b-41d4-a716-446655440000',
          service_name: 'payment-service',
          environment: 'production',
          version: '2.0.0',
          timestamp: '2024-01-15T10:30:00.000Z',
          git_sha: 'abc123def456',
          deployed_by: 'ci-pipeline',
          provider: 'kubernetes',
          metadata: { cluster: 'us-east-1', replicas: 3 },
        },
      });

      expect(response.statusCode).toBe(202);
    });

    it('calls batchInsert with correct table and record', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validDeploymentPayload(),
      });

      expect(mockBatchInsert).toHaveBeenCalledTimes(1);
      const [table, rows] = mockBatchInsert.mock.calls[0];
      expect(table).toBe('deployment_events');
      expect(rows).toHaveLength(1);

      const record = rows[0];
      expect(record.tenant_id).toBe('tenant-1');
      expect(record.project_id).toBe('project-1');
      expect(record.service_name).toBe('payment-service');
      expect(record.environment).toBe('production');
      expect(record.version).toBe('1.2.3');
    });

    it('auto-generates deployment_id when not provided', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validDeploymentPayload(),
      });

      const [, rows] = mockBatchInsert.mock.calls[0];
      const record = rows[0];
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(record.deployment_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('uses provided deployment_id when present', async () => {
      const customId = '550e8400-e29b-41d4-a716-446655440000';
      await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { ...validDeploymentPayload(), deployment_id: customId },
      });

      const [, rows] = mockBatchInsert.mock.calls[0];
      expect(rows[0].deployment_id).toBe(customId);
    });

    it('assigns server time when timestamp is not provided', async () => {
      const before = new Date().toISOString();

      await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validDeploymentPayload(),
      });

      const after = new Date().toISOString();
      const [, rows] = mockBatchInsert.mock.calls[0];
      const timestamp = rows[0].timestamp;

      // Timestamp should be between before and after
      expect(new Date(timestamp).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
      expect(new Date(timestamp).getTime()).toBeLessThanOrEqual(new Date(after).getTime());
    });

    it('uses provided timestamp when present', async () => {
      const customTimestamp = '2024-01-15T10:30:00.000Z';
      await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: { ...validDeploymentPayload(), timestamp: customTimestamp },
      });

      const [, rows] = mockBatchInsert.mock.calls[0];
      expect(rows[0].timestamp).toBe(customTimestamp);
    });

    it('sets optional fields to empty strings when not provided', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: validDeploymentPayload(),
      });

      const [, rows] = mockBatchInsert.mock.calls[0];
      const record = rows[0];
      expect(record.git_sha).toBe('');
      expect(record.deployed_by).toBe('');
      expect(record.provider).toBe('');
      expect(record.metadata).toBe('{}');
    });

    it('includes optional fields when provided', async () => {
      await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          ...validDeploymentPayload(),
          git_sha: 'abc123',
          deployed_by: 'developer@example.com',
          provider: 'aws-ecs',
          metadata: { region: 'us-east-1' },
        },
      });

      const [, rows] = mockBatchInsert.mock.calls[0];
      const record = rows[0];
      expect(record.git_sha).toBe('abc123');
      expect(record.deployed_by).toBe('developer@example.com');
      expect(record.provider).toBe('aws-ecs');
      expect(JSON.parse(record.metadata)).toEqual({ region: 'us-east-1' });
    });

    it('accepts valid ISO 8601 timestamp', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/events/deployments',
        headers: { 'content-type': 'application/json', 'x-api-key': 'valid-key' },
        payload: {
          ...validDeploymentPayload(),
          timestamp: '2024-06-15T14:30:00Z',
        },
      });

      expect(response.statusCode).toBe(202);
    });
  });
});
