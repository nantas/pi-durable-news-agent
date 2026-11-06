# dna-server-api on this machine. Devices run it as a service (see `just net`).

set shell := ["zsh", "-cu"]
set positional-arguments
set working-directory := "../../apps/dna-server-api"

free-port := source_directory() / ".." / "free-port.sh"
port := env("DNA_PORT", "4850")

# List api commands
[default]
default:
    @just --list api

# Run the API (frees the port first)
run *ARGS:
    @{{ free-port }} {{ port }}
    NODE_NO_WARNINGS=1 npx tsx src/main.ts "$@"

# Run with restart on file changes
dev *ARGS:
    @{{ free-port }} {{ port }}
    NODE_NO_WARNINGS=1 npx tsx watch src/main.ts "$@"

# Run on the faux model, fixture jev and fixture sources (free, offline)
faux *ARGS:
    @{{ free-port }} {{ port }}
    DNA_PROVIDER=faux JEV_BACKEND=fixture DNA_WIKI_DIR= DNA_MODEL=faux-haiku DNA_RESEARCH_MODEL=faux-haiku DNA_QUICK_MODEL=anthropic/claude-haiku-5.5 DNA_COVERAGE_MODEL=faux-haiku DNA_DEEP_RESEARCH_MODEL=anthropic/claude-haiku-5.5 DNA_SUMMARY_MODEL=faux-haiku DNA_SEARCH_MODE=fixture DNA_DATA_DIR=${DNA_DATA_DIR:-/tmp/dna-faux} NODE_NO_WARNINGS=1 npx tsx src/main.ts "$@"

# Write client and cron tokens into .env (prints names only; --rotate replaces both)
tokens *ARGS:
    NODE_NO_WARNINGS=1 npx tsx scripts/tokens.ts "$@"

# Fetch every default source once
sources-check:
    NODE_NO_WARNINGS=1 npx tsx scripts/sources-check.ts

# Type check and API tests
check:
    npx tsc -p .
    NODE_NO_WARNINGS=1 npx tsx --test tests/*.test.ts
