import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server.js';
import { authMiddleware, hashApiKey } from './auth.js';

// Mock the postgres module
vi.mock('../db/postgres.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/postgres.js';
const mockQuery = vi.mocked(query);

describe('Auth Middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Register a test route that uses the auth middleware
    app.get('/test-auth', { preHandler: authMiddleware }, async (request) => {
      return { tenantContext: request.tenantContext };
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('hashApiKey', () => {
    it('produces a consistent SHA-256 hex hash', () => {
      const hash = hashApiKey('rootpilot_demo_key');
      // SHA-256 produces a 64-character hex string
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      // Same input should produce same output
      expect(hashApiKey('rootpilot_demo_key')).toBe(hash);
    });
  });

  describe('Missing or empty X-API-Key', () => {
    it('returns 401 AUTH_REQUIRED when header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-auth',
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('AUTH_REQUIRED');
      expect(body.error.message.length).toBeGreaterThanOrEqual(10);
    });

    it('returns 401 AUTH_REQUIRED when header is empty string', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-auth',
        headers: { 'x-api-key': '' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 AUTH_REQUIRED when header is whitespace only', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-auth',
        headers: { 'x-api-key': '   ' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('Invalid API key', () => {
    it('returns 401 AUTH_INVALID when key not found in database', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const response = await app.inject({
        method: 'GET',
        url: '/test-auth',
        headers: { 'x-api-key': 'nonexistent_key' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('AUTH_INVALID');
      expect(body.error.message.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Revoked API key', () => {
    it('returns 401 AUTH_REVOKED when key has revoked_at set', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'key-uuid', tenant_id: 'tenant-uuid', revoked_at: '2024-01-01T00:00:00Z' }],
        rowCount: 1,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test-auth',
        headers: { 'x-api-key': 'revoked_key' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('AUTH_REVOKED');
      expect(body.error.message.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Valid API key', () => {
    it('attaches TenantContext to request when key is valid', async () => {
      // First query: api_keys lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'key-uuid-123', tenant_id: 'tenant-uuid-456', revoked_at: null }],
        rowCount: 1,
      });
      // Second query: projects lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'project-uuid-789' }],
        rowCount: 1,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test-auth',
        headers: { 'x-api-key': 'valid_key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tenantContext).toEqual({
        tenantId: 'tenant-uuid-456',
        projectId: 'project-uuid-789',
        keyId: 'key-uuid-123',
      });
    });

    it('sets empty projectId when no project exists for tenant', async () => {
      // First query: api_keys lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'key-uuid-123', tenant_id: 'tenant-uuid-456', revoked_at: null }],
        rowCount: 1,
      });
      // Second query: no projects found
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test-auth',
        headers: { 'x-api-key': 'valid_key' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tenantContext.projectId).toBe('');
    });
  });
});
