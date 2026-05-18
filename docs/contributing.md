# Contributing

This repo is young and does not yet have CI, so local validation matters.

## Before You Start

```bash
git status --short --branch
git fetch origin
```

If the remote branch exists and a fast-forward is safe, sync before editing.
If the remote branch is absent, continue from the local checkout and mention it
in the handoff.

## Change Guidelines

- Keep changes scoped to the request.
- Do not mix behavior changes with broad refactors.
- Preserve tenant isolation on every API path.
- Update shared types when API response shapes change.
- Update docs when commands, setup, routes, env vars, schema, or limitations
  change.
- Avoid new dependencies unless there is a clear need.
- Do not commit build output, caches, `.env` files, or secrets.

## Validation

Run at minimum:

```bash
npm test
npm run lint
```

Run relevant builds/typechecks:

```bash
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npm run typecheck --workspace=packages/shared
```

Use live smoke checks from `docs/testing.md` when touching storage, seed data,
Docker/local setup, or database clients.

## PR Checklist

- [ ] Remote state checked and synced when possible.
- [ ] App behavior changes have tests.
- [ ] Docs updated for changed behavior or workflow.
- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] Relevant build/typecheck commands pass or blockers are documented.
- [ ] No secrets or local env files included.
- [ ] Known gaps are written as TODOs, not implied as working features.
