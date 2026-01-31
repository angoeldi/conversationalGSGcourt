# Contributing

Thanks for your interest in contributing to The Court. This repo is a showcase spec kit: experiments and clean PRs are welcome.

## Quick setup

Prereqs: Node 20+, pnpm 9+, Docker.

```bash
pnpm install
cp .env.example .env
# add at least one LLM provider key

docker compose up -d
pnpm --filter @thecourt/server db:migrate
pnpm dev
```

## Verification

Run these before opening a PR:

```bash
pnpm -r lint
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

## Architecture rules (read before coding)

- **Engine is pure**: `packages/engine` has no DB, no network, no Date.now.
- **All world changes are Actions**: LLM output must be parsed into Action bundles.
- **Schema-first**: persisted JSON must have a schema in `schemas/` and a Zod mirror in `packages/shared`.
- **Prompts live in docs**: keep LLM prompts in `docs/prompts.md` and reference them from code.
- **Determinism matters**: random outcomes must be seeded and written to the event log.

## Common workflows

- New action type: update shared schema + engine action validation/apply + tests.
- DB changes: add a migration in `apps/server/sql/####_name.sql`, update `docs/db.md`.
- UI changes: keep the tri-panel layout (map | court | chat) and avoid modal sprawl.

## Submitting changes

- Keep PRs focused and small when possible.
- Include a short description, motivation, and testing results.
- If you add new env vars, update `.env.example`.

## Code of Conduct

By participating, you agree to the `CODE_OF_CONDUCT.md`.
