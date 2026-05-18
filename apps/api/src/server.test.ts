import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from './server.js';

describe('Fastify API Server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('returns application/json content type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['content-type']).toContain('application/json');
    });
  });

  describe('Body limit', () => {
    it('rejects payloads exceeding 5 MB', async () => {
      // Create a payload slightly over 5 MB
      const largeBody = JSON.stringify({ data: 'x'.repeat(5 * 1024 * 1024) });

      const response = await app.inject({
        method: 'POST',
        url: '/health',
        headers: { 'content-type': 'application/json' },
        body: largeBody,
      });

      // Fastify returns 413 for payloads exceeding body limit
      expect(response.statusCode).toBe(413);
    });
  });
});
