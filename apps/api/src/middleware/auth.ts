import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/postgres.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: string;
  projectId: string;
  keyId: string;
}

// Augment Fastify's request type to include tenant context
declare module 'fastify' {
  interface FastifyRequest {
    tenantContext: TenantContext;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Hash an API key using SHA-256.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────

/**
 * Fastify preHandler hook that authenticates requests via X-API-Key header.
 *
 * 1. Extracts X-API-Key header
 * 2. Returns 401 AUTH_REQUIRED if missing or empty
 * 3. Hashes the key and queries Postgres for a matching record
 * 4. Returns 401 AUTH_INVALID if no match found
 * 5. Returns 401 AUTH_REVOKED if revoked_at is not null
 * 6. Attaches TenantContext to the request
 */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key'];

  // Check for missing or empty key
  if (!apiKey || (typeof apiKey === 'string' && apiKey.trim() === '')) {
    reply.status(401).send({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication required: provide a valid X-API-Key header',
      },
    });
    return;
  }

  // If header is an array, take the first value
  const key = Array.isArray(apiKey) ? apiKey[0] : apiKey;

  if (!key || key.trim() === '') {
    reply.status(401).send({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication required: provide a valid X-API-Key header',
      },
    });
    return;
  }

  // Hash the key and look it up in Postgres
  const keyHash = hashApiKey(key);

  const apiKeyResult = await query<{
    id: string;
    tenant_id: string;
    revoked_at: string | null;
  }>('SELECT id, tenant_id, revoked_at FROM api_keys WHERE key_hash = $1', [keyHash]);

  // No matching key found
  if (apiKeyResult.rows.length === 0) {
    reply.status(401).send({
      error: {
        code: 'AUTH_INVALID',
        message: 'Authentication failed: the provided API key is not valid',
      },
    });
    return;
  }

  const apiKeyRecord = apiKeyResult.rows[0];

  // Key is revoked
  if (apiKeyRecord.revoked_at !== null) {
    reply.status(401).send({
      error: {
        code: 'AUTH_REVOKED',
        message: 'Authentication failed: the provided API key has been revoked',
      },
    });
    return;
  }

  // Look up the project for this tenant
  const projectResult = await query<{ id: string }>(
    'SELECT id FROM projects WHERE tenant_id = $1 LIMIT 1',
    [apiKeyRecord.tenant_id],
  );

  const projectId = projectResult.rows.length > 0 ? projectResult.rows[0].id : '';

  // Attach tenant context to the request
  request.tenantContext = {
    tenantId: apiKeyRecord.tenant_id,
    projectId,
    keyId: apiKeyRecord.id,
  };
}
