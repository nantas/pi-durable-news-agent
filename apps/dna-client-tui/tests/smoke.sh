#!/usr/bin/env bash
# Drive dna-tui in tmux and grep the screen.
#   tests/smoke.sh faux        boot a faux dna-server-api with fixture search, run one sweep, then attach
#   tests/smoke.sh <device>    attach to a device from dna-network.yaml with the client token from .env
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=${1:-faux}
S="dna-smoke-$$"
TMP=$(mktemp -d /tmp/dna-smoke.XXXXXX)
API_PID=""
cleanup() {
  tmux kill-session -t "$S" 2>/dev/null || true
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

pass() { echo "PASS $*"; }
screen() { tmux capture-pane -t "$S" -p -J -S -400; }
wait_for() { # pattern [seconds]
  local end=$((SECONDS + ${2:-30}))
  while ((SECONDS < end)); do
    screen | grep -Eq -- "$1" && return 0
    sleep 0.3
  done
  echo "FAIL: timed out waiting for /$1/"
  screen | tail -40
  exit 1
}
# Slash commands close the autocomplete menu with Escape before Enter; plain text goes straight in.
send() {
  tmux send-keys -t "$S" -l -- "$1"
  sleep 0.2
  case "$1" in /*) tmux send-keys -t "$S" Escape ;; esac
  tmux send-keys -t "$S" Enter
}

if [ "$TARGET" = "faux" ]; then
  PORT=$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')
  CLIENT="dna_$(openssl rand -hex 24)"
  CRON="dna_$(openssl rand -hex 24)"
  (cd ../dna-server-api && exec env DNA_ENV_FILE=none DNA_PROVIDER=faux JEV_BACKEND=fixture DNA_WIKI_DIR= DNA_MODEL=faux-haiku DNA_RESEARCH_MODEL=faux-haiku DNA_QUICK_MODEL=anthropic/claude-haiku-5.5 DNA_COVERAGE_MODEL=faux-haiku DNA_DEEP_RESEARCH_MODEL=anthropic/claude-haiku-5.5 DNA_SUMMARY_MODEL=faux-haiku DNA_SEARCH_MODE=fixture DNA_DATA_DIR="$TMP/data" DNA_LOG_DIR="$TMP/logs" \
    DNA_DEVICE_NAME=faux-smoke DNA_CLIENT_TOKEN="$CLIENT" DNA_CRON_TOKEN="$CRON" NODE_NO_WARNINGS=1 node --import tsx src/main.ts --port "$PORT" >"$TMP/api.log" 2>&1) &
  API_PID=$!
  for _ in $(seq 1 150); do curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 0.1; done
  curl -sf -X POST -H "authorization: Bearer $CRON" -H "content-type: application/json" -d '{"requestId":"smoke:1"}' "http://127.0.0.1:$PORT/v1/workflows/news-sweep" >/dev/null
  for _ in $(seq 1 150); do curl -sf -H "authorization: Bearer $CLIENT" "http://127.0.0.1:$PORT/v1/sweeps/1" | grep -q '"status":"completed"' && break; sleep 0.2; done
  ENVS="DNA_ENV_FILE=none DNA_CLIENT_TOKEN=$CLIENT DNA_LOG_DIR=$TMP/logs"
  ARGS="--url http://127.0.0.1:$PORT --device faux-smoke"
else
  ENVS=""
  ARGS="--device $TARGET"
fi

tmux new-session -d -s "$S" -x 140 -y 45 "env $ENVS NODE_NO_WARNINGS=1 npx tsx src/main.ts $ARGS; sleep 600"
wait_for "● live" 30
pass "attached to $TARGET"

send "/feed"
wait_for "\[feed\]" 10
wait_for "(游戏设计方法|创作与生产工具|内容参考与储备|Signal|Facts|Hype) [0-9]+" 10
pass "/feed shows ranked cards"
[ -n "${SHOTS:-}" ] && screen > "$SHOTS/feed.txt"
CARD=$(screen | grep -Eo '#[0-9]+ (brief|signal_alert|thread_pulse|headline|fact_check|hype_watch|release|quote)' | head -1 | grep -Eo '[0-9]+')

send "/search agent"
wait_for "search agent" 10
wait_for "(#[0-9]+ +[a-z_]+ |No news matches agent)" 10
pass "/search agent"

if [ "$TARGET" = "faux" ]; then
  # Writes run on the throwaway faux API only. A live device is the reader's: no feedback, settings or chat.
  send "/more $CARD"
  wait_for "Show me more" 10
  pass "/more $CARD"

  send "/label $CARD signal facts"
  wait_for "Labeled $CARD: signal facts" 10
  pass "/label $CARD signal facts"

  send "/schedule 30"
  wait_for "Sweeps every 30 min" 10
  send "/schedule 15"
  wait_for "Sweeps every 15 min" 10
  pass "/schedule 30 then 15"

  send "/compaction 100 200"
  wait_for "Compaction bg 100k force 200k" 10
  wait_for "bg 100k  force 200k" 10
  pass "/compaction 100 200"

  send "/chat"
  send "hello"
  wait_for "hello" 10
  wait_for "Got it\\. hello" 20
  pass "a message gets an answer"
  [ -n "${SHOTS:-}" ] && screen > "$SHOTS/chat.txt"
else
  send "/card $CARD"
  wait_for "esc returns to the chat" 10
  pass "/card $CARD (read only on a live device)"

  wait_for "bg [0-9]+k  force [0-9]+k" 10
  pass "the status line shows the compaction points (read only on a live device)"
fi
send "/runs"
wait_for "news-desk" 10
pass "/runs lists the agent runs"
[ -n "${SHOTS:-}" ] && screen > "$SHOTS/runs.txt"

send "/quit"
wait_for "The agent keeps running on" 10
pass "/quit leaves the agent running"
echo "ALL TUI SMOKE CHECKS PASSED ($TARGET)"
