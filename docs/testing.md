# Testing

RootPilot uses Vitest across the monorepo.

## Baseline Commands

```bash
npm test
npm run lint
```

## Current Known Validation Gaps

Observed in this checkout while updating docs:

- `npm test` runs the API suites successfully but fails Web tests with
  `React is not defined` in JSX test files and `mockUseParams.mockReturnValue is
not a function` in `apps/web/src/__tests__/trace-explorer.test.tsx`.
- `npm run lint` fails on existing source/test issues, mostly
  `@typescript-eslint/consistent-type-imports`, plus a few unused imports/helpers.

TODO: verify and remove this section after the test setup and lint issues are
fixed.

Run focused suites:

```bash
npm test --workspace=apps/api
npm test --workspace=apps/web
```

Build/typecheck commands:

```bash
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npm run typecheck --workspace=packages/shared
```

## Test Layout

- API tests live beside API code under `apps/api/src/**/*.test.ts`.
- Web tests live under `apps/web/src/__tests__/*.test.tsx`.
- Normalizer and route property tests use fast-check:
  - `apps/api/src/normalizers/normalizers.property.test.ts`
  - `apps/api/src/routes/ingest/ingestion.property.test.ts`
  - `apps/api/src/routes/query/query.property.test.ts`

## API Tests

API tests create a Fastify app with `buildApp({ logger: false })` and use
Fastify `inject()` for HTTP assertions. Route tests usually mock:

- `apps/api/src/db/postgres.ts`
- `apps/api/src/db/clickhouse.ts`

That keeps tests fast and deterministic, but it means a green unit suite does
not prove the live Postgres or ClickHouse schema is compatible.

When changing API behavior, cover:

- missing, invalid, and revoked `X-API-Key`
- payload validation failures
- tenant-scoped query parameters
- pagination cursors and limit boundaries
- ClickHouse query parameters, not raw string interpolation

## Web Tests

Web tests use jsdom and React Testing Library. `apps/web/src/test-setup.ts`
mocks Next navigation helpers and `next/link`.

When changing UI behavior, cover:

- loading state
- empty state
- error state
- data rendering
- user interaction that changes filters or pagination

## Live Smoke Checks

Use live checks when touching DB clients, SQL, seed data, or Docker/local setup:

```bash
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
npm run db:init
npm run dev --workspace=apps/api
npm run seed
curl http://localhost:4000/health
curl -s http://localhost:4000/v1/services -H "X-API-Key: rootpilot_demo_key"
```

Start the web app separately and inspect `http://localhost:3000`:

```bash
npm run dev --workspace=apps/web
```

See `docs/troubleshooting.md` if services cannot connect.
