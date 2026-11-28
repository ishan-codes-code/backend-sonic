#!/data/data/com.termux/files/usr/bin/bash

BACKEND_BRANCH="${BACKEND_BRANCH:-release/v4}"

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

RECONFIGURE=0
for arg in "$@"; do
  if [[ "$arg" == '--reconfigure' ]]; then
    RECONFIGURE=1
  fi
done

REPO="$HOME/backend-sonic"
export PATH="$HOME/.local/bin:$PREFIX/bin:$PATH"

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
    git clone --branch "$BACKEND_BRANCH" https://github.com/ishan-codes-code/backend-sonic.git "$REPO"
else
  if [[ -f "$REPO/logs/supervisor.pid" ]]; then
    "$REPO/scripts/run.sh" stop
  fi
  run_step 'Updating backend-sonic' bash -c 'cd "$1" && git fetch origin "$2" && git checkout "$2" && git pull --ff-only' _ "$REPO" "$BACKEND_BRANCH"
fi

if [[ "$RECONFIGURE" -eq 1 ]]; then
  # Services are stopped here, so removing the stored hash is safe. The API
  # generates and prints a new setup token on its next start.
  rm -f "$REPO/data/setup-token.sha256"
fi

cd "$REPO"
mkdir -p "$HOME/.gyp" &&
  printf "{'variables': {'android_ndk_path': ''}}\n" >"$HOME/.gyp/include.gypi"
run_step 'Installing Node.js dependencies' npm ci --ignore-scripts
run_step 'Rebuilding bcrypt for Termux' npm rebuild bcrypt
run_step 'Building API and worker' npm run build

mkdir -p "$REPO/logs" "$REPO/data"

SETUP_SCRIPT="$REPO/dist/scripts/setup-database.js"
if [[ "$RECONFIGURE" -eq 0 ]] && node "$SETUP_SCRIPT" --check; then
  printf 'Database is already configured; skipping database setup.\n'
else
  if ! exec 3</dev/tty 2>/dev/null; then
    fail_step 'No terminal is available for the database prompt. Rerun this installer interactively or set DATABASE_URL before installing.'
  fi
  exec 3<&-
  DB_CONFIGURED=0
  for attempt in 1 2 3 4 5; do
    printf 'Paste your Neon database URL: '
    if ! read -r DB_URL </dev/tty; then
      printf '\n'
      fail_step 'Could not read the database URL. Rerun this installer interactively or set DATABASE_URL before installing.'
    fi
    if SETUP_DATABASE_URL="$DB_URL" node "$SETUP_SCRIPT"; then
      DB_CONFIGURED=1
      break
    fi
    printf 'Database setup failed (attempt %s of 5). Check the error above and try again.\n' "$attempt" >&2
  done
  unset DB_URL
  if [[ "$DB_CONFIGURED" -ne 1 ]]; then
    fail_step 'Database setup failed 5 times. Check your Neon database URL and rerun the installer.'
  fi
fi

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
  health_body="$(curl -fsS --max-time 8 http://127.0.0.1:3000/health 2>/dev/null || true)"
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
printf '\nSonic backend is running.\n'
printf 'Enter this URL in the mobile app: http://%s:3000\n' "$LAN_IP"
SETUP_TOKEN_LINE="$(grep 'SETUP TOKEN:' "$REPO/logs/api.log" 2>/dev/null | tail -n 1 || true)"
if [[ -n "$SETUP_TOKEN_LINE" ]]; then
  printf 'Enter this setup token in the mobile app: %s\n' "$SETUP_TOKEN_LINE"
elif [[ "$health_body" == *'"setupRequired":true'* ]]; then
  printf 'Setup is incomplete and no setup token was found in %s/logs/api.log.\n' "$REPO"
  printf 'Rerun the installer with --reconfigure to generate a new token:\n'
  printf '  curl -fsSL https://raw.githubusercontent.com/ishan-codes-code/backend-sonic/%s/scripts/install-termux.sh | bash -s -- --reconfigure\n' "$BACKEND_BRANCH"
fi
printf 'Logs: %s/logs/ (supervisor restarts API and worker after exits).\n' "$REPO"
}

main "$@"
