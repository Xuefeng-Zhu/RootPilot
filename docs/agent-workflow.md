# Agent Workflow

This guide is for coding agents working in RootPilot.

## Start Every Task

1. Read the user request carefully.
2. Check repo state:

   ```bash
   git status --short --branch
   ```

3. Fetch remote metadata:

   ```bash
   git fetch origin
   ```

4. Fast-forward only when the remote branch exists and it is safe.
5. Inspect relevant files before editing.

## Before Editing

- Identify whether the task is docs-only, behavior, tests, or release/setup.
- Check existing docs under `docs/` and `.kiro/specs/`.
- For API work, inspect route, normalizer, shared types, and tests together.
- For Web work, inspect the page, `apps/web/src/lib/api.ts`, tests, and shared
  response types.
- For schema work, inspect `infra/init-postgres.sql`,
  `infra/init-clickhouse.sql`, DB clients, seed script, and architecture docs.

## Edit Safely

- Keep changes narrow.
- Preserve unrelated user edits.
- Use existing module patterns.
- Do not introduce secrets.
- Do not imply unsupported features in docs.
- Write `TODO: verify` when a deployment or production fact is unclear.

## Validate

Docs-only changes:

```bash
npm run lint
```

Behavior changes:

```bash
npm test
npm run lint
```

Workspace builds when relevant:

```bash
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npm run typecheck --workspace=packages/shared
```

Live storage changes:

```bash
docker compose -f infra/docker-compose.yml up -d postgres clickhouse
npm run db:init
npm run dev --workspace=apps/api
npm run seed
```

## Handoff

Summarize:

- files changed
- validation run
- blockers or assumptions
- next recommended checks

Call out known current repo limitations:

- no CI config
- no API/Web Dockerfiles despite Compose references
- tests mostly mock databases
- Web API client hardcodes localhost and the demo key
