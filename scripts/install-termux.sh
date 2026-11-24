#!/data/data/com.termux/files/usr/bin/bash

fail_step() {
  printf 'Failed: %s\n' "$1" >&2
  exit 1
}

run_step() {
  local description="$1"
  shift
  printf '\n==> %s\n' "$description"
  "$@" </dev/null || fail_step "$description"
}

main() {
set -euo pipefail

if [[ -z "${PREFIX:-}" || "$PREFIX" != *"/com.termux/"* ]]; then
  fail_step 'This installer must run inside Termux on Android.'
fi

REPO="$HOME/backend-sonic"
export PATH="$HOME/.local/bin:$PREFIX/bin:$PATH"
PREVIOUS_TOKEN_COUNT=0
if [[ -f "$REPO/logs/api.log" ]]; then
  PREVIOUS_TOKEN_COUNT="$(awk '/^SETUP TOKEN: / { count++ } END { print count+0 }' "$REPO/logs/api.log")"
fi

run_step 'Updating Termux packages' pkg update -y
run_step 'Installing Git, Node.js, Python, FFmpeg, and build tools' \
  pkg install -y git nodejs-lts python ffmpeg make clang pkg-config curl iproute2 termux-api
run_step 'Installing yt-dlp' \
  python -m pip install --upgrade --break-system-packages yt-dlp
run_step 'Verifying yt-dlp installation' yt-dlp --version

if [[ ! -d "$REPO/.git" ]]; then
  if [[ -e "$REPO" ]]; then
    fail_step "$REPO exists but is not a Git checkout; move it and retry."
  fi
  run_step 'Cloning backend-sonic' \
    git clone https://github.com/ishan-codes-code/backend-sonic.git "$REPO"
else
  if [[ -f "$REPO/logs/supervisor.pid" ]]; then
    "$REPO/scripts/run.sh" stop
  fi
  run_step 'Updating backend-sonic' bash -c 'cd "$1" && git pull --ff-only' _ "$REPO"
fi

cd "$REPO"
run_step 'Installing Node.js dependencies' npm ci
run_step 'Building API and worker' npm run build

mkdir -p "$REPO/logs" "$REPO/data"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || printf 'Note: termux-wake-lock was unavailable.\n'
else
  printf 'Note: install the Termux:API Android app to enable termux-wake-lock.\n'
fi

nohup "$REPO/scripts/run.sh" \
  >>"$REPO/logs/supervisor.log" 2>&1 </dev/null &
printf '%s\n' "$!" >"$REPO/logs/supervisor.pid"

if command -v pm >/dev/null 2>&1 && pm list packages 2>/dev/null | grep -q '^package:com.termux.boot$'; then
  mkdir -p "$HOME/.termux/boot"
  cat >"$HOME/.termux/boot/start-sonic.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cd "$HOME/backend-sonic"
mkdir -p logs data
termux-wake-lock 2>/dev/null || true
if [[ ! -f logs/supervisor.pid ]]; then
  nohup "$HOME/backend-sonic/scripts/run.sh" \
    >>logs/supervisor.log 2>&1 </dev/null &
  printf '%s\n' "$!" >logs/supervisor.pid
else
  pid="$(cat logs/supervisor.pid)"
  process_args=''
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    process_args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  fi
  if [[ "$process_args" != *"$HOME/backend-sonic/scripts/run.sh"* ]]; then
    nohup "$HOME/backend-sonic/scripts/run.sh" \
      >>logs/supervisor.log 2>&1 </dev/null &
    printf '%s\n' "$!" >logs/supervisor.pid
  fi
fi
BOOT
  chmod 700 "$HOME/.termux/boot/start-sonic.sh"
  printf 'Termux:Boot detected; created ~/.termux/boot/start-sonic.sh\n'
else
  printf 'For auto-start after reboot, install the Termux:Boot Android app and rerun this installer.\n'
fi

API_READY=0
for _ in {1..20}; do
  health_body="$(curl -fsS --max-time 1 http://127.0.0.1:3000/health 2>/dev/null || true)"
  if [[ "$health_body" == *'"app":"sonic-backend"'* ]]; then
    API_READY=1
    break
  fi
  sleep 1
done
if [[ "$API_READY" != 1 ]]; then
  fail_step "API did not start; inspect $REPO/logs/api.log and $REPO/logs/supervisor.log."
fi

LAN_IP="$(timeout 5 termux-wifi-connectioninfo 2>/dev/null |
  sed -n 's/.*"ip"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
  head -n 1 || true)"
if [[ "$LAN_IP" == 127.* || "$LAN_IP" == 169.254.* ]]; then
  LAN_IP=''
fi

if [[ -z "$LAN_IP" ]]; then
  LAN_IP="$(ip -o -4 addr show wlan0 2>/dev/null |
    awk 'NR == 1 { split($4, a, "/"); print a[1] }' || true)"
  if [[ "$LAN_IP" == 127.* || "$LAN_IP" == 169.254.* ]]; then
    LAN_IP=''
  fi
fi
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="$(ip -o -4 addr show 2>/dev/null |
    awk '$2 !~ /lo/ && !found { split($4, a, "/"); print a[1]; found=1 }' || true)"
  if [[ "$LAN_IP" == 127.* || "$LAN_IP" == 169.254.* ]]; then
    LAN_IP=''
  fi
fi
if [[ -z "$LAN_IP" ]]; then
  LAN_IP='127.0.0.1'
  printf 'Could not detect your Wi-Fi address. Find it in Android Wi-Fi settings and use http://<that-ip>:3000\n'
fi
TOKEN_COUNT="$(awk '/^SETUP TOKEN: / { count++ } END { print count+0 }' "$REPO/logs/api.log")"
SETUP_TOKEN=''
if (( TOKEN_COUNT > PREVIOUS_TOKEN_COUNT )); then
  SETUP_TOKEN="$(awk '/^SETUP TOKEN: / { token=$NF } END { print token }' "$REPO/logs/api.log")"
fi

printf '\nSonic backend is running.\n'
printf 'Enter this URL in the mobile app: http://%s:3000\n' "$LAN_IP"
if [[ -n "$SETUP_TOKEN" ]]; then
  printf 'One-time setup token: %s\n' "$SETUP_TOKEN"
else
  printf 'The setup token was already issued; it is not reprinted. Keep the token from first install.\n'
fi
printf 'Logs: %s/logs/ (supervisor restarts API and worker after exits).\n' "$REPO"
}

main "$@"
