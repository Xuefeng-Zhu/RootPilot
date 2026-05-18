# Troubleshooting

## `docker compose up` fails because Dockerfiles are missing

Current symptom:

```text
failed to read dockerfile: open apps/api/Dockerfile: no such file or directory
```

or the equivalent for `apps/web/Dockerfile`.

Current workaround:

```bash
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web
```

The Compose file defines API and Web services, but the Dockerfiles are not
present in this checkout.

## `npm run seed` fails

The seed script needs Postgres and the API server.

Check:

```bash
docker compose -f infra/docker-compose.yml ps
curl http://localhost:4000/health
```

Then retry:

```bash
npm run seed
```

## API cannot connect to Postgres

Defaults:

- host: `localhost`
- port: `5432`
- database: `rootpilot`
- user: `rootpilot`
- password: `rootpilot`

Check the container:

```bash
docker compose -f infra/docker-compose.yml ps postgres
docker compose -f infra/docker-compose.yml logs postgres
```

Recreate local data if the schema is inconsistent and local data can be lost:

```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
npm run db:init
```

## API cannot connect to ClickHouse

Defaults:

- host: `localhost`
- HTTP port: `8123`
- database: `rootpilot`

Check:

```bash
curl http://localhost:8123/ping
docker compose -f infra/docker-compose.yml logs clickhouse
```

Re-run initialization:

```bash
npm run db:init
```

## Web UI shows API errors

The current browser API client calls `http://localhost:4000` directly and sends
`X-API-Key: rootpilot_demo_key`.

Check:

```bash
curl http://localhost:4000/health
curl -s http://localhost:4000/v1/services -H "X-API-Key: rootpilot_demo_key"
```

If auth fails, run:

```bash
npm run seed
```

## Tests pass but live API fails

Most API route tests mock Postgres and ClickHouse. For DB-client, SQL, seed, or
schema changes, run the live smoke checks in `docs/testing.md`.

## Web tests fail with `React is not defined`

Current Web tests use JSX in test files without importing React, while the test
transform is not making React available globally for those files.

Related symptom in trace detail tests:

```text
mockUseParams.mockReturnValue is not a function
```

See `apps/web/src/test-setup.ts` and `apps/web/vitest.config.ts` before changing
individual page components. This is a test setup issue unless a page change
introduced a new runtime failure.

## Lint fails on type import errors

Current lint output includes many existing
`@typescript-eslint/consistent-type-imports` errors in API source and tests.
Fix these mechanically with care, but avoid mixing that cleanup into unrelated
feature or docs changes.

## Port conflicts

Expected ports:

- API: `4000`
- Web: `3000`
- Postgres: `5432`
- ClickHouse HTTP: `8123`
- ClickHouse native: `9000`

Find listeners:

```bash
lsof -i :4000
lsof -i :3000
```

Stop the conflicting local process or change the relevant port env var where the
code supports it.
