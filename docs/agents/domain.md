# Domain Docs

How engineering skills consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area being changed.

## File structure

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── apps/
```

Do not create per-app domain contexts unless the repository deliberately adopts a `CONTEXT-MAP.md` layout.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, proposal, hypothesis, or test name, use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary avoids.

If a needed concept is absent, reconsider whether it belongs to this domain; if it is a real gap, resolve it through domain modeling rather than inventing a parallel term.

## Flag ADR conflicts

If output contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
