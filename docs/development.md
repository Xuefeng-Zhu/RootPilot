# Development

This guide describes the current local workflow for RootPilot.

## Prerequisites

- Node.js 20+
- npm 9+
- Docker 24+ with Docker Compose v2

Check versions:

```bash
node --version
npm --version
docker --version
docker compose version
```

## Install

Use the lockfile for repeatable installs:

```bash
npm ci
```

Use `npm install` only when intentionally updating dependencies and the lockfile.

## Local Infrastructure

Start Postgres and ClickHouse:

```bash
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
```

Initialize schemas:

```bash
npm run db:init
npm run db:migrate
```

Stop services:

```bash
docker compose -f infra/docker-compose.yml down
```

Remove stored local data:

```bash
docker compose -f infra/docker-compose.yml down -v
```

## App Servers

Run the API and Web app in separate terminals:

```bash
npm run dev --workspace=apps/api
npm run dev --workspace=apps/web
```

Ports:

- API: `http://localhost:4000`
- Web: `http://localhost:3000`
- Postgres: `localhost:5432`
- ClickHouse HTTP: `localhost:8123`

The root `npm run dev` script runs workspace dev scripts, but separate terminals
are clearer for long-running servers.

## Seed Data

After Postgres, ClickHouse, and the API are running:

```bash
npm run seed
```

The seed script creates:

- tenant `demo`
- project `default`
- API key `rootpilot_demo_key`
- sample logs, traces, metrics, and deployment events

## Environment Variables

The code has local defaults. No `.env` file is present in this checkout.

API:

| Variable            | Default     | Used by                   |
| ------------------- | ----------- | ------------------------- |
| `API_HOST`          | `0.0.0.0`   | `apps/api/src/index.ts`   |
| `API_PORT`          | `4000`      | `apps/api/src/index.ts`   |
| `POSTGRES_HOST`     | `localhost` | API DB client and scripts |
| `POSTGRES_PORT`     | `5432`      | API DB client and scripts |
| `POSTGRES_DB`       | `rootpilot` | API DB client and scripts |
| `POSTGRES_USER`     | `rootpilot` | API DB client and scripts |
| `POSTGRES_PASSWORD` | `rootpilot` | API DB client and scripts |
| `CLICKHOUSE_HOST`   | `localhost` | API DB client and scripts |
| `CLICKHOUSE_PORT`   | `8123`      | API DB client and scripts |
| `CLICKHOUSE_DB`     | `rootpilot` | API DB client             |

Seed script:

| Variable  | Default                 | Purpose                |
| --------- | ----------------------- | ---------------------- |
| `API_URL` | `http://localhost:4000` | Ingestion API base URL |

Web:

- `apps/web/src/lib/api.ts` uses `NEXT_PUBLIC_API_BASE_URL` or `/api` by
  default, and sends the demo API key `rootpilot_demo_key`.
- `apps/web/next.config.js` contains a rewrite from `/api/:path*` to
  `http://localhost:4000/:path*`.

## Docker Compose Caveat

`infra/docker-compose.yml` defines `api` and `web` services, but this checkout
does not include `apps/api/Dockerfile` or `apps/web/Dockerfile`. Use DB-only
Compose plus local workspace dev servers until Dockerfiles are added.

## Common Development Tasks

Run all tests:

```bash
npm test
```

Run lint and formatting checks:

```bash
npm run lint
```

Build workspaces:

```bash
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npm run typecheck --workspace=packages/shared
```

Refresh Phase 2 service graph and correlation data:

```bash
npm run simulate:bad-deploy -- --duration 10m --rate 30
npm run phase2:refresh -- --from now-2h --to now
```

Use API examples from `docs/local-development.md` for manual smoke checks.
