# Security

This document captures the current security model. It is not a production
security review.

## Authentication

All ingestion and query routes must use `authMiddleware` from
`apps/api/src/middleware/auth.ts`.

The middleware:

1. Reads the `X-API-Key` header.
2. Rejects missing or blank keys with `AUTH_REQUIRED`.
3. Hashes the key with SHA-256.
4. Looks up the hash in Postgres `api_keys`.
5. Rejects unknown keys with `AUTH_INVALID`.
6. Rejects revoked keys with `AUTH_REVOKED`.
7. Attaches `tenantId`, `projectId`, and `keyId` to the Fastify request.

## Tenant Isolation

Tenant isolation is application-enforced:

- Ingestion routes stamp every canonical row with `request.tenantContext.tenantId`.
- Query routes must include `tenant_id = {tenantId:String}` in ClickHouse reads.
- The system must not trust tenant or project IDs supplied by clients.

Postgres and ClickHouse do not currently enforce row-level isolation for the app.
Route-level tenant filters are therefore critical.

## API Keys

- API key hashes are stored in Postgres, not plaintext keys.
- `key_prefix` stores the first 8 characters for display/identification.
- `rootpilot_demo_key` is a local demo key used by the seed script, docs, and
  current Web UI.
- Do not use the demo key as a production credential.
- Do not commit `.env` files or real keys.

## Telemetry Privacy

Telemetry payloads can contain sensitive data:

- request headers
- user IDs
- trace attributes
- log messages
- deployment metadata

Avoid logging raw request bodies or full stored telemetry rows in application
logs. When adding diagnostics, prefer counts, IDs, and sanitized error messages.

## Query Safety

ClickHouse queries should use `query_params` through
`apps/api/src/db/clickhouse.ts`. Never interpolate user input directly into SQL.

Allowed SQL fragments such as aggregation functions and interval values must be
selected from explicit allowlists before being inserted into query text.

## Current Gaps

- No rate limiting is implemented.
- No HTTPS/TLS termination is configured in this repo.
- No production secret management is present.
- No CI security checks are configured.
- No audit logging is implemented.
- The Web UI hardcodes the demo API key.

Document these as gaps unless and until the implementation changes.
