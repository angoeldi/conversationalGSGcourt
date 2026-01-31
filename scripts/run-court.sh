#!/usr/bin/env bash
set -euo pipefail
set -E

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COURT_LOG="/tmp/thecourt-dev.log"
COURT_SERVER_PID="/tmp/thecourt-server.pid"
COURT_WEB_PID="/tmp/thecourt-web.pid"
COURT_LOCK_DIR="/tmp/thecourt-run.lock"
COURT_LOCK_PID="$COURT_LOCK_DIR/pid"
COURT_BROWSER_FRESH="${COURT_BROWSER_FRESH:-0}"
COURT_BROWSER_PROFILE_DIR="${COURT_BROWSER_PROFILE_DIR:-}"
TTY_IN="/dev/tty"
TTY_OK=0
if [ -r "$TTY_IN" ]; then
  TTY_OK=1
fi

: > "$COURT_LOG"

port_is_open() {
  local port="$1"
  (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
}

pid_in_repo() {
  local pid="$1"
  local cwd=""
  if [ -d "/proc/$pid" ]; then
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  fi
  if [ -z "${cwd:-}" ] && command -v pwdx >/dev/null 2>&1; then
    cwd="$(pwdx "$pid" 2>/dev/null | awk '{print $2}' || true)"
  fi
  if [ -n "${cwd:-}" ] && [[ "$cwd" == "$REPO_ROOT"* ]]; then
    return 0
  fi
  return 1
}

wait_for_port() {
  local port="$1"
  local host="127.0.0.1"
  for _ in $(seq 1 40); do
    if (echo >/dev/tcp/$host/$port) >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_for_port_closed() {
  local port="$1"
  for _ in $(seq 1 40); do
    if ! port_is_open "$port"; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

prepare_browser_profile() {
  if [ -n "${COURT_BROWSER_PROFILE_DIR:-}" ]; then
    mkdir -p "$COURT_BROWSER_PROFILE_DIR"
    return 0
  fi
  if [ "$COURT_BROWSER_FRESH" = "1" ]; then
    COURT_BROWSER_PROFILE_DIR="$(mktemp -d /tmp/thecourt-fresh-profile.XXXXXX)"
    export COURT_BROWSER_PROFILE_DIR
    echo "Using fresh browser profile: $COURT_BROWSER_PROFILE_DIR"
  fi
}

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

describe_pids() {
  local pids="$1"
  for pid in $pids; do
    ps -p "$pid" -o pid=,comm=,args= 2>/dev/null || true
  done
}

keep_open() {
  echo
  echo "Press Enter to close this window."
  if [ "$TTY_OK" -eq 1 ]; then
    read -r _ < "$TTY_IN"
  else
    tail -f /dev/null
  fi
}

fail() {
  echo "ERROR: $1" >&2
  if [ -f "$COURT_LOG" ]; then
    echo
    echo "Last 120 log lines:"
    tail -n 120 "$COURT_LOG" || true
  fi
  stop_services
  cleanup
  keep_open
  exit 1
}

trap 'fail "Startup failed."' ERR

if [ ! -f .env ]; then
  fail "Missing .env at $REPO_ROOT/.env"
fi

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1090
    source "$HOME/.nvm/nvm.sh"
  fi
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@9.15.0 --activate >/dev/null 2>&1 || true
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm not found in PATH. Ensure pnpm is installed or available via nvm/corepack."
  fi
}

ensure_pnpm

export DOTENV_CONFIG_PATH="$REPO_ROOT/.env"
set -a
# shellcheck disable=SC1090
source "$DOTENV_CONFIG_PATH"
set +a

acquire_lock() {
  if mkdir "$COURT_LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$COURT_LOCK_PID"
    return 0
  fi
  if [ -f "$COURT_LOCK_PID" ]; then
    local owner_pid
    owner_pid="$(cat "$COURT_LOCK_PID" 2>/dev/null || true)"
    if [ -n "${owner_pid:-}" ] && kill -0 "$owner_pid" >/dev/null 2>&1; then
      echo "The Court is already running (PID $owner_pid)."
      keep_open
      exit 0
    fi
  fi
  rm -rf "$COURT_LOCK_DIR" 2>/dev/null || true
  mkdir "$COURT_LOCK_DIR" 2>/dev/null || true
  echo "$$" > "$COURT_LOCK_PID"
}

release_lock() {
  if [ -f "$COURT_LOCK_PID" ]; then
    local owner_pid
    owner_pid="$(cat "$COURT_LOCK_PID" 2>/dev/null || true)"
    if [ "$owner_pid" = "$$" ]; then
      rm -rf "$COURT_LOCK_DIR" 2>/dev/null || true
    fi
  fi
}

acquire_lock

stop_dev_only() {
  for pid_file in "$COURT_SERVER_PID" "$COURT_WEB_PID"; do
    if [ -f "$pid_file" ]; then
      local pid
      pid=$(cat "$pid_file" || true)
      if [ -n "${pid:-}" ] && kill -0 "$pid" >/dev/null 2>&1; then
        echo "Stopping existing process (PID $pid)..."
        kill "$pid" >/dev/null 2>&1 || true
        for _ in $(seq 1 20); do
          if ! kill -0 "$pid" >/dev/null 2>&1; then
            break
          fi
          sleep 0.25
        done
      fi
      rm -f "$pid_file"
    fi
  done
}

stop_repo_processes() {
  local pids=""
  while read -r pid args; do
    case "$args" in
      *"pnpm -r --parallel dev"*|*"pnpm --filter @thecourt/web dev"*|*"tsx watch src/index.ts"*|*"tsx "*apps/server*|*"vite "*apps/web*|*"apps/server/dist/index.js"*)
        if pid_in_repo "$pid"; then
          pids="${pids} ${pid}"
        fi
        ;;
    esac
  done < <(ps ax -o pid=,args=)
  if [ -n "${pids// }" ]; then
    echo "Stopping existing Court dev processes:${pids}"
    for pid in $pids; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    sleep 0.5
  fi
}

stop_dev_only
stop_repo_processes

force_kill_ports() {
  for port in 5173 8787; do
    local pids
    pids="$(find_pids_by_port "$port")"
    if [ -n "${pids// }" ]; then
      echo "Stopping process(es) on port $port:${pids}"
      for pid in $pids; do
        kill "$pid" >/dev/null 2>&1 || true
      done
      for _ in $(seq 1 20); do
        sleep 0.25
        local still_running=""
        for pid in $pids; do
          if kill -0 "$pid" >/dev/null 2>&1; then
            still_running="yes"
          fi
        done
        if [ -z "$still_running" ]; then
          break
        fi
      done
      for pid in $pids; do
        if kill -0 "$pid" >/dev/null 2>&1; then
          kill -9 "$pid" >/dev/null 2>&1 || true
        fi
      done
    fi
  done
}

force_kill_ports

ensure_ports_free() {
  for port in 5173 8787; do
    for _ in $(seq 1 10); do
      local pids
      pids="$(find_pids_by_port "$port")"
      if [ -z "${pids// }" ]; then
        sleep 0.2
        if [ -z "$(find_pids_by_port "$port")" ]; then
          break
        fi
      else
        echo "Stopping process(es) on port $port:${pids}"
        for pid in $pids; do
          kill "$pid" >/dev/null 2>&1 || true
        done
      fi
    done
    if [ -n "$(find_pids_by_port "$port")" ]; then
      fail "Port $port is still in use after cleanup."
    fi
  done
}

kill_repo_ports() {
  for port in 5173 8787; do
    pids="$(find_pids_by_port "$port")"
    if [ -n "${pids// }" ]; then
      for pid in $pids; do
        if pid_in_repo "$pid"; then
          kill "$pid" >/dev/null 2>&1 || true
        fi
      done
    fi
  done
}

kill_repo_ports

for port in 5173 8787; do
  pids="$(find_pids_by_port "$port")"
  if [ -n "${pids// }" ]; then
    repo_pids=""
    other_pids=""
    for pid in $pids; do
      if pid_in_repo "$pid"; then
        repo_pids="${repo_pids} $pid"
      else
        other_pids="${other_pids} $pid"
      fi
    done
    if [ -n "${repo_pids// }" ]; then
      echo "Stopping existing process(es) on port $port:${repo_pids}"
      for pid in $repo_pids; do
        kill "$pid" >/dev/null 2>&1 || true
      done
      sleep 0.5
    fi
    pids_after="$(find_pids_by_port "$port")"
    if [ -n "${pids_after// }" ]; then
      echo "Port $port is already in use by:"
      describe_pids "$pids_after"
      fail "Free port $port before running The Court."
    fi
    if ! wait_for_port_closed "$port"; then
      fail "Port $port did not close after stopping existing processes."
    fi
  else
    if port_is_open "$port"; then
      echo "Port $port is already open but no PID info is available."
      echo "Try: sudo lsof -iTCP:$port -sTCP:LISTEN or sudo ss -ltnp 'sport = :$port'"
      fail "Free port $port before running The Court."
    fi
  fi
done

ensure_ports_free

if command -v docker >/dev/null 2>&1; then
  docker compose up -d
else
  fail "Docker is required to run the postgres service."
fi

DOTENV_CONFIG_PATH="$REPO_ROOT/.env" pnpm --filter @thecourt/server db:migrate

: > "$COURT_LOG"

DOTENV_CONFIG_PATH="$REPO_ROOT/.env" pnpm --filter @thecourt/shared build >> "$COURT_LOG" 2>&1
DOTENV_CONFIG_PATH="$REPO_ROOT/.env" pnpm --filter @thecourt/engine build >> "$COURT_LOG" 2>&1
DOTENV_CONFIG_PATH="$REPO_ROOT/.env" pnpm --filter @thecourt/server build >> "$COURT_LOG" 2>&1

ensure_ports_free

node "$REPO_ROOT/apps/server/dist/index.js" >> "$COURT_LOG" 2>&1 &
echo $! > "$COURT_SERVER_PID"

if ! wait_for_port 8787; then
  fail "Server port 8787 did not open. Check the log for details."
fi

start_web() {
  local web_root="$REPO_ROOT/apps/web"
  local vite_bin="$web_root/node_modules/.bin/vite"
  if [ -x "$vite_bin" ]; then
    (
      cd "$web_root"
      DOTENV_CONFIG_PATH="$REPO_ROOT/.env" "$vite_bin" \
        --config "$web_root/vite.config.ts" \
        --port 5173 \
        --strictPort >> "$COURT_LOG" 2>&1 &
      echo $! > "$COURT_WEB_PID"
    )
  else
    (
      cd "$web_root"
      DOTENV_CONFIG_PATH="$REPO_ROOT/.env" pnpm dev -- --port 5173 --strictPort >> "$COURT_LOG" 2>&1 &
      echo $! > "$COURT_WEB_PID"
    )
  fi
}

start_web

echo "The Court services are starting."
echo "UI: http://localhost:5173/court"
echo "Server: http://localhost:8787/health"
echo "Log: $COURT_LOG"

open_browser() {
  local url="http://localhost:5173/court/"
  local profile_dir="${COURT_BROWSER_PROFILE_DIR:-}"
  local has_fresh_profile=0
  if [ -n "${profile_dir:-}" ]; then
    has_fresh_profile=1
  fi
  export DISPLAY="${DISPLAY:-:0}"
  if command -v firefox >/dev/null 2>&1; then
    if [ "$has_fresh_profile" -eq 1 ]; then
      firefox --no-remote --profile "$profile_dir" "$url" >/dev/null 2>&1 &
    else
      if pgrep -x firefox >/dev/null 2>&1; then
        firefox --new-tab "$url" >/dev/null 2>&1 &
      else
        firefox "$url" >/dev/null 2>&1 &
      fi
    fi
    return 0
  fi
  if command -v firefox-esr >/dev/null 2>&1; then
    if [ "$has_fresh_profile" -eq 1 ]; then
      firefox-esr --no-remote --profile "$profile_dir" "$url" >/dev/null 2>&1 &
    else
      if pgrep -x firefox-esr >/dev/null 2>&1; then
        firefox-esr --new-tab "$url" >/dev/null 2>&1 &
      else
        firefox-esr "$url" >/dev/null 2>&1 &
      fi
    fi
    return 0
  fi
  if command -v flatpak >/dev/null 2>&1; then
    if flatpak list --app --columns=application 2>/dev/null | grep -q '^org.mozilla.firefox$'; then
      if [ "$has_fresh_profile" -eq 1 ]; then
        flatpak run org.mozilla.firefox --no-remote --profile "$profile_dir" "$url" >/dev/null 2>&1 &
      else
        flatpak run org.mozilla.firefox --new-window "$url" >/dev/null 2>&1 &
      fi
      return 0
    fi
  fi
  if [ "$has_fresh_profile" -eq 1 ]; then
    if command -v google-chrome >/dev/null 2>&1; then
      google-chrome --user-data-dir="$profile_dir" --new-window "$url" >/dev/null 2>&1 &
      return 0
    fi
    if command -v chromium >/dev/null 2>&1; then
      chromium --user-data-dir="$profile_dir" --new-window "$url" >/dev/null 2>&1 &
      return 0
    fi
    if command -v chromium-browser >/dev/null 2>&1; then
      chromium-browser --user-data-dir="$profile_dir" --new-window "$url" >/dev/null 2>&1 &
      return 0
    fi
    return 1
  fi
  if command -v gio >/dev/null 2>&1; then
    gio open "$url" >/dev/null 2>&1 &
    return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
    return 0
  fi
  return 1
}

if ! wait_for_port 5173; then
  echo "UI port 5173 did not open yet; check the log for Vite errors." >&2
else
  prepare_browser_profile
  if ! open_browser; then
    echo "Browser launch failed; open the UI manually." >&2
  fi
fi

tail -f "$COURT_LOG" &
TAIL_PID=$!

stop_tail() {
  if [ -n "${TAIL_PID:-}" ] && kill -0 "$TAIL_PID" >/dev/null 2>&1; then
    kill "$TAIL_PID" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  stop_tail
  release_lock
}

stop_pid() {
  local pid="$1"
  if [ -z "${pid:-}" ]; then
    return 0
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi
  kill -INT "$pid" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  kill -TERM "$pid" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  kill -9 "$pid" >/dev/null 2>&1 || true
}

stop_services() {
  for pid_file in "$COURT_SERVER_PID" "$COURT_WEB_PID"; do
    if [ -f "$pid_file" ]; then
      local pid
      pid=$(cat "$pid_file" || true)
      stop_pid "$pid"
      rm -f "$pid_file"
    fi
  done
  if command -v docker >/dev/null 2>&1; then
    docker compose down >/dev/null 2>&1 || true
  fi
  stop_repo_processes
  kill_repo_ports
}

trap cleanup EXIT

echo "Streaming logs."
echo "Press Enter or Ctrl+X to stop services and close this window."

if [ "$TTY_OK" -ne 1 ]; then
  echo "No TTY detected; close this window to stop viewing logs."
  wait "$TAIL_PID"
  exit 0
fi

while true; do
  IFS= read -r -n1 key < "$TTY_IN" || true
  if [ -z "${key:-}" ] || [ "$key" = $'\n' ] || [ "$key" = $'\r' ]; then
    echo
    echo "Stopping services..."
    stop_tail
    stop_services
    cleanup
    exit 0
  fi
  if [ "$key" = $'\x18' ]; then
    echo
    echo "Stopping services..."
    stop_tail
    stop_services
    cleanup
    exit 0
  fi
done
