# AGENTS.md

This guide is for coding agents and human contributors working in RootPilot.
Keep it accurate to the current checkout and prefer small, verified changes over
speculative rewrites.

## Project Overview

RootPilot is a Phase 1 observability platform. It ingests OpenTelemetry-style
logs, traces, and metrics plus custom deployment events, stores telemetry in
ClickHouse, stores tenant metadata and API keys in Postgres, and serves a
Next.js UI for exploring the data.

Phase 1 is intentionally narrow. Do not document or implement alerting, AI
investigation, incident management, RUM, synthetics, profiling, SIEM, SSO, or
third-party integrations unless a new product decision adds them.

## Tech Stack

- Monorepo: npm workspaces
- Runtime: Node.js 20+
- API: Fastify, TypeScript, `tsx`
- Web: Next.js 14 App Router, React 18, Tailwind CSS
- Shared types: `packages/shared`
- Datastores: ClickHouse for telemetry, Postgres for metadata/API keys
- Tests: Vitest, React Testing Library, fast-check property tests
- Formatting/linting: ESLint, Prettier
- Local infrastructure: Docker Compose in `infra/docker-compose.yml`

## Repository Structure

```text
apps/api/                 Fastify API, ingestion/query routes, DB clients
apps/web/                 Next.js UI pages, shared API client, UI tests
packages/shared/          Canonical telemetry models and API response types
infra/                    Docker Compose, Postgres/ClickHouse init SQL, OTel config
docs/                     Contributor, architecture, development, and runbook docs
.kiro/specs/...           Phase 1 requirements/design/tasks source material
```

Important entry points:

- `apps/api/src/server.ts`: Fastify app factory and route registration
- `apps/api/src/index.ts`: API process entry point
- `apps/api/src/middleware/auth.ts`: API key auth and tenant context
- `apps/api/src/routes/ingest/`: write paths into ClickHouse
- `apps/api/src/routes/query/`: read paths from ClickHouse
- `apps/api/src/normalizers/`: OTLP to canonical model conversion
- `apps/api/src/db/`: Postgres and ClickHouse clients
- `apps/web/src/app/`: UI routes
- `apps/web/src/lib/api.ts`: browser-side API client
- `packages/shared/src/`: shared models, pagination, and response types

## Important Commands

```bash
npm ci
npm test
npm run lint
npm run db:init
npm run seed
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npm run typecheck --workspace=packages/shared
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
docker compose -f infra/docker-compose.yml down
```

Notes:

- Use `npm ci` for a clean install from `package-lock.json`.
- The root `npm run dev` script exists, but for reliable local work use separate
  terminals for the API and Web workspace dev servers.
- `npm run seed` requires Postgres and the API server to be running.

## Setup Instructions

1. Install Node.js 20+ and Docker.
2. Install dependencies:

   ```bash
   npm ci
   ```

3. Start only the databases:

   ```bash
   docker compose -f infra/docker-compose.yml up -d postgres clickhouse
   ```

4. Initialize schemas:

   ```bash
   npm run db:init
   ```

5. Start the API and web app in separate terminals:

   ```bash
   npm run dev --workspace=apps/api
   npm run dev --workspace=apps/web
   ```

6. Seed demo data after the API is healthy:

   ```bash
   npm run seed
   ```

7. Open `http://localhost:3000`.

Current local demo key: `rootpilot_demo_key`. This is hardcoded in the demo UI
and seed script; do not treat it as a production credential.

## Development Workflow

- Sync with the latest remote branch before new work when a remote branch exists.
  At the time this file was written, `origin/main` was not advertised by the
  remote, so the local checkout was the source of truth.
- Check `git status --short --branch` before editing. Preserve unrelated user
  changes.
- Keep app behavior changes separate from documentation-only changes.
- Update docs when changing routes, commands, env vars, schema, security model,
  or developer workflow.
- Prefer existing patterns: Fastify route plugins, explicit validation, typed
  helpers, parameterized database queries, React client components for
  interactive UI.
- Do not add dependencies unless the task explicitly requires them and the
  existing stack cannot reasonably solve the problem.

## Testing And Validation

Baseline validation:

```bash
npm test
npm run lint
```

Useful focused commands:

```bash
npm test --workspace=apps/api
npm test --workspace=apps/web
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npm run typecheck --workspace=packages/shared
```

Test behavior:

- API tests use Fastify `inject()`.
- Most route tests mock Postgres and ClickHouse clients.
- Web tests use jsdom and React Testing Library.
- Property tests use fast-check for normalizers, ingestion validation, and query
  invariants.

For live smoke checks, run Postgres, ClickHouse, API, and Web locally, then use
the curl examples in `docs/local-development.md`.

## Coding Conventions

- TypeScript is strict. Respect `noUnusedLocals`, `noUnusedParameters`, and
  `noUncheckedIndexedAccess`.
- Use type-only imports where possible; ESLint enforces consistent type imports.
- Prefer `Record<string, unknown>` over `any`; existing tests use `any` in a few
  places for mocks.
- Use 2-space indentation, single quotes, semicolons, trailing commas, and
  100-character print width.
- API route files should validate inputs before touching storage.
- ClickHouse reads must use `query_params`; do not concatenate untrusted values
  into SQL.
- Shared response and model types belong in `packages/shared/src`.

## Architecture Overview

The API has two main flows:

- Ingestion: `X-API-Key` auth -> OTLP/custom payload validation -> normalizer ->
  ClickHouse batch insert.
- Query: `X-API-Key` auth -> query parameter validation -> tenant-scoped
  ClickHouse query -> typed response.

The Web UI calls the API from client components and renders:

- Overview dashboard: service, log, trace, metric summaries
- Logs explorer: filters, search, load more, detail drawer
- Trace explorer: list and trace waterfall detail
- Metrics explorer: metric selector, line chart, values table
- Services catalog: health indicators derived from recent errors
- Settings: masked demo key and curl examples

See `docs/architecture.md` for diagrams and storage details.

## Key Modules And Responsibilities

- `auth.ts`: hashes `X-API-Key`, checks `api_keys`, rejects missing/invalid/revoked
  keys, and attaches `TenantContext`.
- `normalizers/*.ts`: convert OTLP input into canonical rows and apply defaults.
- `routes/ingest/*.ts`: enforce payload shape and insert canonical rows.
- `routes/query/*.ts`: validate filters, apply tenant scoping, return paginated or
  aggregated data.
- `db/clickhouse.ts`: singleton ClickHouse client with JSONEachRow inserts and
  parameterized reads.
- `db/postgres.ts`: Postgres pool and parameterized query helper.
- `apps/web/src/lib/api.ts`: demo API client using `http://localhost:4000` and
  `rootpilot_demo_key`.

## State Management And Data Flow

The web app uses local React state inside each page. There is no global client
store, offline cache, browser persistence, or background sync layer in the
current codebase.

Telemetry persistence is server-side:

- Postgres stores tenants, projects, and hashed API keys.
- ClickHouse stores logs, spans, metrics, and deployment events with 90-day TTLs.
- The demo seed script creates one tenant/project/API key and posts sample
  telemetry through the ingestion API.

## Storage And Sync Behavior

- ClickHouse tables are initialized from `infra/init-clickhouse.sql`.
- Postgres tables are initialized from `infra/init-postgres.sql`.
- There is no migration framework. Schema changes currently require updating SQL
  files and documenting the manual transition plan.
- There is no cross-device sync or local-first storage behavior.

## Security And Privacy Considerations

- Every ingestion and query route must use `authMiddleware`.
- Tenant isolation is enforced in application code through `tenant_id` filters.
- Never trust a client-supplied tenant ID or project ID.
- API keys are stored as SHA-256 hashes in Postgres.
- Do not print real secrets or add `.env` files to git.
- The demo key is visible in code and docs for local development only.
- Avoid logging raw telemetry payloads unless explicitly needed for debugging.
  Logs can contain user data, secrets, or production identifiers.
- Cross-tenant trace detail lookups should return 404/not found behavior, not a
  response that reveals another tenant's data exists.

## Common Pitfalls For Coding Agents

- `infra/docker-compose.yml` references `apps/api/Dockerfile` and
  `apps/web/Dockerfile`, but those Dockerfiles are not present. Use DB-only
  Compose plus local dev servers unless adding the Dockerfiles is in scope.
- `docs/local-development.md` has useful curl examples, but keep its setup notes
  aligned with the real Dockerfile situation.
- The Web API client is hardcoded to `http://localhost:4000`; Next rewrites do
  not affect those browser fetches.
- `npm run seed` fails if the API is not running.
- Tests mostly mock the database clients. Passing tests do not prove live
  Postgres/ClickHouse compatibility.
- Current Web tests have known setup failures around JSX React globals and the
  `useParams` mock. See `docs/testing.md`.
- Current lint has existing type-import hygiene failures. See `docs/testing.md`.
- The root branch tracks `origin/main`, but that remote branch may not exist in
  a fresh checkout. Verify before trying to fast-forward.
- Do not remove the tenant filter from ClickHouse queries, even temporarily.
- Query cursor formats are base64 JSON and should stay backward-compatible
  within a route.

## Safe-Change Guidelines

- For API changes, update the route, shared response types, tests, and docs
  together.
- For ingestion changes, update the normalizer and route validation tests.
- For schema changes, update `infra/init-*.sql`, architecture docs, and any seed
  data that depends on the schema.
- For UI changes, preserve loading, empty, and error states.
- For security-sensitive changes, add or update tests for invalid auth,
  revoked keys, and tenant scoping.
- Keep documentation examples copy-pasteable and avoid placeholder secrets.

## Release And Build Notes

- No CI configuration is present in `.github/`.
- No deployment pipeline is present.
- No Dockerfiles are present for the API or Web services, despite Compose
  references.
- The package is private and versioned `0.1.0`.
- Before any release-like handoff, run tests, lint, and workspace builds.
- TODO: verify the intended production hosting, image build process, and release
  versioning flow before publishing deployment documentation as authoritative.

## PR Checklist

- [ ] Synced with the latest available remote branch or documented why not.
- [ ] Preserved unrelated user changes.
- [ ] Updated docs for changed commands, routes, schema, env vars, or workflows.
- [ ] Added/updated focused tests for behavior changes.
- [ ] Ran `npm test`.
- [ ] Ran `npm run lint`.
- [ ] Ran relevant workspace builds or typechecks.
- [ ] Verified no secrets, local `.env` files, build artifacts, or generated
      caches are included.
- [ ] Documented known limitations or TODOs instead of implying unsupported
      behavior exists.

## Areas That Need Extra Caution

- Auth and tenant isolation
- ClickHouse query construction and pagination
- OTLP normalization and payload limits
- Postgres/ClickHouse schema drift
- Demo API key behavior in the Web UI
- Docker/release documentation until Dockerfiles and CI are added
- Tests that mock storage but are used to justify live-storage changes
