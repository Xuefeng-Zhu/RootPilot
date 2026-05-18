# Release And Build Notes

RootPilot does not currently have a complete release pipeline in this checkout.
Treat this document as the current build handoff checklist, not as production
deployment documentation.

## Current State

- Root package is private and versioned `0.1.0`.
- No `.github/` CI configuration is present.
- No deployment configuration is present.
- `infra/docker-compose.yml` references `apps/api/Dockerfile` and
  `apps/web/Dockerfile`, but those Dockerfiles are not present.
- There is no root `build` script.
- Database schema is initialized from SQL files and forward changes are applied
  with the simple Postgres migration runner.

## Local Build Checks

Run before release-like handoff:

```bash
npm ci
npm test
npm run lint
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npm run build --workspace=apps/simulator
npm run typecheck --workspace=packages/shared
```

## Runtime Smoke Check

```bash
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
npm run db:init
npm run db:migrate
npm run dev --workspace=apps/api
npm run seed
npm run simulate:bad-deploy -- --duration 10m --rate 30
npm run correlations:refresh -- --from now-2h --to now
curl http://localhost:4000/health
curl -s http://localhost:4000/v1/services -H "X-API-Key: rootpilot_demo_key"
```

Then run the Web app:

```bash
npm run dev --workspace=apps/web
```

Verify the main UI routes:

- `/`
- `/logs`
- `/traces`
- `/metrics`
- `/service-map`
- `/services`
- `/error-groups`
- `/deployments`
- `/settings`

## Before Adding Real Deployment Docs

TODO: verify the intended deployment target.

TODO: add or confirm API and Web Dockerfiles if Docker images are the release
artifact.

TODO: define how the local migration runner maps to a future hosted deployment
pipeline.

TODO: define production secret management for Postgres, ClickHouse, and API
keys.

TODO: add CI if PR validation is expected.
