#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"
LOG_DIR="$ROOT/logs"
PID_FILE="$LOG_DIR/supervisor.pid"
mkdir -p "$LOG_DIR"

if [[ "${1:-}" == "stop" ]]; then
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    process_args=''
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      process_args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    fi
    if [[ "$process_args" == *"$ROOT/scripts/run.sh"* ]]; then
      kill "$pid"
      for _ in {1..10}; do
        if ! kill -0 "$pid" 2>/dev/null; then
          break
        fi
        sleep 1
      done
      if kill -0 "$pid" 2>/dev/null; then
        printf 'Supervisor %s did not stop in time.\n' "$pid" >&2
        exit 1
      fi
    fi
    rm -f "$PID_FILE"
  fi
  exit 0
fi

cd "$ROOT"

run_service() {
  local name="$1"
  local entry="$2"
  local status
  local service_pid=''
  stop_service() {
    trap - EXIT INT TERM
    if [[ -n "$service_pid" ]] && kill -0 "$service_pid" 2>/dev/null; then
      kill "$service_pid" 2>/dev/null || true
      wait "$service_pid" 2>/dev/null || true
    fi
    exit 0
  }
  trap stop_service EXIT INT TERM

  while true; do
    node "$entry" >>"$LOG_DIR/$name.log" 2>&1 &
    service_pid=$!
    if wait "$service_pid"; then
      status=0
    else
      status=$?
    fi
    service_pid=''
    printf '%s exited with status %s; restarting in 2 seconds.\n' \
      "$name" "$status" >>"$LOG_DIR/$name.log"
    sleep 2
  done
}

run_service api dist/apps/api/main.js &
api_pid=$!
run_service worker dist/apps/worker/main.js &
worker_pid=$!
printf '%s\n' "$$" >"$PID_FILE"

stop_children() {
  trap - EXIT INT TERM
  kill "$api_pid" "$worker_pid" 2>/dev/null || true
  wait "$api_pid" "$worker_pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}
trap stop_children EXIT INT TERM

wait "$api_pid" "$worker_pid"
