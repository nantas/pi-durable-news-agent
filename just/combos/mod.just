# Recipes that touch several apps at once.

set shell := ["zsh", "-cu"]
set positional-arguments

# List combo commands
[default]
[no-cd]
default:
    @just --list combos

# Faux API plus hub with hot reload (free, offline)
[no-cd]
dev:
    trap 'kill 0' EXIT; just api faux & sleep 3; just browser dev local

# Live API plus hub with hot reload; Ctrl-C stops both
[no-cd]
live:
    trap 'kill 0' EXIT; just api dev & sleep 3; just browser dev local

# This Mac, always on: API and UI in the background, plus the crontab tick
[no-cd]
local:
    just net up local
    just net cron local install
    @echo "status: just net status local   stop (UI, API and tick): just net down local"

# A remote device (a Mac mini, a Linux box or an exe.dev VM): bring it up, then live e2e
[no-cd]
remote DEVICE *ARGS:
    just net up "$1"
    just test live "$@" --wait-cron
