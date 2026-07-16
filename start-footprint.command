#!/bin/bash

set -u
cd "$(dirname "$0")" || exit 1

RUNTIME="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
if [ -x "$RUNTIME/node" ]; then
  export PATH="$RUNTIME:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "Agent Footprint needs Node.js" message "Install Node.js 22.13 or newer, then try again."' 2>/dev/null
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  osascript -e 'display alert "Agent Footprint needs Ollama" message "Install Ollama and the llama3.2 model, then try again."' 2>/dev/null
  exit 1
fi

if ! ollama list 2>/dev/null | grep -q '^llama3\.2:'; then
  echo "Downloading Llama 3.2 for the first run…"
  ollama pull llama3.2 || exit 1
fi

if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  open -a Ollama 2>/dev/null || (ollama serve > /tmp/agent-footprint-ollama.log 2>&1 &)
  for _ in {1..20}; do
    curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
    sleep 1
  done
fi

# Stop only an older viewer launched from this exact folder.
while read -r old_pid; do
  [ -n "$old_pid" ] && kill "$old_pid" 2>/dev/null || true
done < <(ps -ax -o pid=,command= | awk -v project="$PWD/node_modules/.bin/vinext" 'index($0, project) { print $1 }')
sleep 1

free_port() {
  local port="$1"
  while /usr/sbin/lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do port=$((port + 1)); done
  echo "$port"
}

API_PORT=$(free_port 4317)
WEB_PORT=$(free_port 3000)

if [ ! -d node_modules ]; then
  echo "Preparing Agent Footprint…"
  npm install || exit 1
fi

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

FOOTPRINT_API_PORT="$API_PORT" FOOTPRINT_MODEL="llama3.2:latest" node local-server.mjs > /tmp/agent-footprint-analyzer.log 2>&1 &
API_PID=$!
npm run dev -- --port "$WEB_PORT" --strictPort > /tmp/agent-footprint-viewer.log 2>&1 &
WEB_PID=$!

READY=0
for _ in {1..30}; do
  if ! kill -0 "$API_PID" 2>/dev/null || ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "Agent Footprint could not start. See /tmp/agent-footprint-viewer.log for details."
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null | grep -q '"version":"9"' && curl -fsS "http://localhost:$WEB_PORT" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "Agent Footprint did not become ready. See /tmp/agent-footprint-viewer.log for details."
  exit 1
fi

open "http://localhost:$WEB_PORT/?api=$API_PORT&version=9&launch=$(date +%s)"
echo
echo "Agent Footprint Version 9 is running with Llama 3.2."
echo "Keep this window open. Press Control-C to stop."
wait "$WEB_PID"
