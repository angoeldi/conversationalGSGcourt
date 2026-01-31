#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COURT_SERVER_PID="/tmp/thecourt-server.pid"
COURT_WEB_PID="/tmp/thecourt-web.pid"

find_pids_by_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ' || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\\([0-9]\\+\\).*/\\1/p' | tr '\n' ' ' || true
    return 0
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $7}' | cut -d/ -f1 | tr '\n' ' ' || true
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null | tr '\n' ' ' || true
    return 0
  fi
  echo ""
}

kill_repo_ports() {
  for port in 5173 8787; do
    pids="$(find_pids_by_port "$port")"
    if [ -n "${pids// }" ]; then
      for pid in $pids; do
        cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
        if echo "$cmd" | grep -q "$REPO_ROOT"; then
          kill "$pid" >/dev/null 2>&1 || true
        fi
      done
    fi
  done
}

stop_repo_processes() {
  local pids
  if command -v rg >/dev/null 2>&1; then
    pids=$(ps ax -o pid=,args= | rg "$REPO_ROOT" --no-messages | rg -e "pnpm -r --parallel dev" -e "pnpm --filter @thecourt/web dev" -e "tsx .*apps/server" -e "vite.*apps/web" -e "apps/server/dist/index.js" --no-messages | awk '{print $1}' || true)
  else
    pids=$(ps ax -o pid=,args= | grep -F "$REPO_ROOT" | grep -E "pnpm -r --parallel dev|pnpm --filter @thecourt/web dev|tsx .*apps/server|vite.*apps/web|apps/server/dist/index.js" | awk '{print $1}' || true)
  fi
  if [ -n "${pids// }" ]; then
    echo "Stopping existing Court dev processes:${pids}"
    for pid in $pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 0.5
  fi
}

for pid_file in "$COURT_SERVER_PID" "$COURT_WEB_PID"; do
  if [ -f "$pid_file" ]; then
    PID=$(cat "$pid_file")
    if kill -0 "$PID" >/dev/null 2>&1; then
      kill "$PID" >/dev/null 2>&1 || true
      sleep 1
      if kill -0 "$PID" >/dev/null 2>&1; then
        kill -9 "$PID" >/dev/null 2>&1 || true
      fi
      echo "Stopped process (PID $PID)."
    fi
    rm -f "$pid_file"
  fi
done

stop_repo_processes
kill_repo_ports

if command -v docker >/dev/null 2>&1; then
  docker compose down >/dev/null 2>&1 || true
fi

echo "The Court services stopped."
