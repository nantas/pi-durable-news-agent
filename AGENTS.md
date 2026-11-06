# AGENTS.md

## Toolchain and boundaries

- Requires Node.js 24 or newer, npm workspaces, and `just`.
- Applications live in `apps/dna-*`; shared contracts and infrastructure live in `apps/shared/packages/*` and `apps/shared/tests/`.
- `dna-server-api` owns news state, SQLite, durable agents, JEV, and the HTTP API. Put shared wire contracts in `@dna/sdk`, not in individual clients.
- Browser, CLI, and TUI expose the same capabilities. Browser secrets stay in the hub; the cron service schedules work but does not own workflow state.
- TypeScript uses ESM, NodeNext resolution, strict mode, and explicit `.ts` imports for local TypeScript modules.

## Commands

- Install all workspaces: `just install`.
- Run the API: `just api dev`; run the Browser hub: `just browser dev`.
- Standard validation: `just test unit` (type checks, lint, format check, and unit tests).
- Recovery and workflow tests: `just test faux`; prompt conventions: `just test prompts`.
- Browser UI tests: `just test ui`; documentation links: `just test docs`.
- Format source and tests: `just test fmt`.
- `just test jev-live` and `just test live <device>` call real models and can spend money; do not use them for routine validation.
- Copy `.env.example` to `.env` for local secrets. Never commit `.env`, `dna-network.yaml`, `data/`, or `logs/`.

## Change conventions

- Keep the SDK route/capability definitions and all three clients in sync. The capability tests require CLI and TUI coverage and a Browser `data-cap="<capability>"` control for every capability.
- Keep agent prompts under `apps/dna-server-api/prompt_engineering/agents/<agent>/`; do not inline them in TypeScript or Vue. Every `USER_PROMPT_*.md` needs a `## Definition Of Done`.
- JEV commands live under `prompt_engineering/jev/<name>/command.json`. Bump the command version when questions change because callers memoize by command and version.
- Unit and faux tests use scripted models, fixtures, or mock JEV. Preserve checkpoint/idempotency coverage for durable workflow changes; recovery tests use temporary SQLite directories and clean them up.
- Formatting uses oxfmt with two-space indentation and 100-column print width.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues using `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels without renaming. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
