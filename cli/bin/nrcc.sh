#!/usr/bin/env bash
# =====================================================================
# NRCC launcher (Linux + macOS).
#
# Reads $INSTALL_DIR/install.json (written by install.sh) to decide
# whether to drive `docker compose` or a PID-tracked Node process.
# =====================================================================

set -euo pipefail

# Resolve the install dir from this script's location: bin/nrcc -> ../
SELF="$(readlink -f "$0" 2>/dev/null || python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$0" 2>/dev/null || echo "$0")"
INSTALL_DIR="$(cd "$(dirname "$SELF")/.." && pwd)"
INSTALL_JSON="$INSTALL_DIR/install.json"

[[ -f "$INSTALL_JSON" ]] || { echo "nrcc: missing $INSTALL_JSON -- did the installer finish?" >&2; exit 1; }

# Tiny JSON value reader (matches simple "key": "value" pairs).
json_get() {
  local key="$1"
  sed -nE "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" "$INSTALL_JSON" | head -n1
}

METHOD="$(json_get method)"
URL="$(json_get url)"
PORT="$(json_get port)"
PLATFORM="$(json_get platform)"
REPO="$(json_get repo)"
BRANCH="$(json_get branch)"
APP_DIR="$(json_get appDir)"
NODE_PATH="$(json_get nodePath)"
PID_FILE="$INSTALL_DIR/nrcc.pid"
LOG_FILE="$INSTALL_DIR/nrcc.log"

c_reset=$'\033[0m'; c_bold=$'\033[1m'
c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_blu=$'\033[34m'
log()  { printf "%s[nrcc]%s %s\n"   "$c_blu" "$c_reset" "$*"; }
ok()   { printf "%s[nrcc]%s %s\n"   "$c_grn" "$c_reset" "$*"; }
warn() { printf "%s[nrcc]%s %s\n"   "$c_yel" "$c_reset" "$*"; }
die()  { printf "%s[nrcc] ERROR:%s %s\n" "$c_red" "$c_reset" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

open_url() {
  local target="${1:-$URL}"
  case "$PLATFORM" in
    macos) open "$target" >/dev/null 2>&1 || true ;;
    *)     if have xdg-open; then xdg-open "$target" >/dev/null 2>&1 || true
           else echo "Open this URL in your browser: $target"
           fi ;;
  esac
}

is_running() {
  case "$METHOD" in
    docker)
      ( cd "$INSTALL_DIR" && docker compose ps --status running --services 2>/dev/null | grep -q '^nrcc$' )
      ;;
    source)
      [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
      ;;
  esac
}

cmd_start() {
  if is_running; then ok "Already running -- $URL"; return 0; fi
  case "$METHOD" in
    docker)
      log "Starting NRCC + guacd via docker compose ..."
      ( cd "$INSTALL_DIR" && docker compose up -d )
      ;;
    source)
      [[ -d "$APP_DIR" ]] || die "App dir not found: $APP_DIR"
      [[ -x "$NODE_PATH" ]] || die "Node binary not found: $NODE_PATH"
      log "Starting NRCC server (logs: $LOG_FILE) ..."
      (
        cd "$APP_DIR"
        export PORT="$PORT"
        export NRCC_TLS_CERT_DIR="${NRCC_TLS_CERT_DIR:-$INSTALL_DIR/data/certs}"
        export NRCC_SCREENSHOTS_DIR="${NRCC_SCREENSHOTS_DIR:-$INSTALL_DIR/data/screenshots}"
        export NRCC_RECORDINGS_DIR="${NRCC_RECORDINGS_DIR:-$INSTALL_DIR/data/recordings}"
        export NRCC_SCRIPTS_DIR="${NRCC_SCRIPTS_DIR:-$INSTALL_DIR/data/scripts}"
        export NRCC_LOGS_DIR="${NRCC_LOGS_DIR:-$INSTALL_DIR/data/logs}"
        export NRCC_LOGGING="${NRCC_LOGGING:-true}"
        export NUTANIX_TLS_SKIP_VERIFY="${NUTANIX_TLS_SKIP_VERIFY:-true}"
        nohup "$NODE_PATH" server.js >> "$LOG_FILE" 2>&1 &
        echo $! > "$PID_FILE"
      )
      ;;
  esac
  # Wait briefly for the port to come up.
  for _ in $(seq 1 20); do
    if (echo > /dev/tcp/127.0.0.1/"$PORT") >/dev/null 2>&1; then break; fi
    sleep 1
  done
  ok "Running at $URL"
}

cmd_stop() {
  case "$METHOD" in
    docker)
      log "Stopping NRCC ..."
      ( cd "$INSTALL_DIR" && docker compose down )
      ;;
    source)
      if [[ -f "$PID_FILE" ]]; then
        local pid; pid="$(cat "$PID_FILE")"
        if kill -0 "$pid" 2>/dev/null; then
          log "Stopping PID $pid ..."
          kill "$pid" || true
          for _ in 1 2 3 4 5; do
            if ! kill -0 "$pid" 2>/dev/null; then break; fi
            sleep 1
          done
          if kill -0 "$pid" 2>/dev/null; then
            warn "PID $pid did not exit cleanly; sending SIGKILL"
            kill -9 "$pid" || true
          fi
        fi
        rm -f "$PID_FILE"
      else
        warn "No PID file -- nothing to stop"
      fi
      ;;
  esac
  ok "Stopped"
}

cmd_restart() { cmd_stop || true; cmd_start; }

cmd_status() {
  if is_running; then
    ok  "RUNNING -- $URL  (method: $METHOD)"
  else
    warn "STOPPED       (method: $METHOD)"
    return 1
  fi
}

cmd_logs() {
  case "$METHOD" in
    docker) ( cd "$INSTALL_DIR" && docker compose logs -f --tail=200 ) ;;
    source)
      [[ -f "$LOG_FILE" ]] || die "No log file at $LOG_FILE yet"
      tail -F -n 200 "$LOG_FILE"
      ;;
  esac
}

cmd_open() {
  is_running || cmd_start
  open_url "$URL"
}

cmd_upgrade() {
  case "$METHOD" in
    docker)
      log "Pulling latest container image ..."
      ( cd "$INSTALL_DIR" && docker compose pull && docker compose up -d )
      ok "Upgrade complete -- $URL"
      ;;
    source)
      [[ -d "$APP_DIR/.git" ]] || die "App dir not a git checkout: $APP_DIR"
      log "git pull ..."
      ( cd "$APP_DIR" && git fetch --depth 1 origin "$BRANCH" && git reset --hard "origin/$BRANCH" )
      log "Refreshing dependencies ..."
      ( cd "$APP_DIR" && PATH="$(dirname "$NODE_PATH"):$PATH" "$(dirname "$NODE_PATH")/npm" ci --omit=dev --no-audit --no-fund )
      cmd_restart
      ;;
  esac
}

cmd_enable_service() {
  case "$PLATFORM" in
    linux)
      local unit_dir="$HOME/.config/systemd/user"
      mkdir -p "$unit_dir"
      local unit_file="$unit_dir/nrcc.service"
      log "Writing $unit_file"
      sed -e "s|@LAUNCHER@|$INSTALL_DIR/bin/nrcc|g" \
          -e "s|@INSTALLDIR@|$INSTALL_DIR|g" \
          "$INSTALL_DIR/templates/nrcc.service" > "$unit_file"
      systemctl --user daemon-reload
      systemctl --user enable --now nrcc.service
      if have loginctl; then loginctl enable-linger "$USER" >/dev/null 2>&1 || true; fi
      ok "Enabled. Manage with: systemctl --user {status|stop|restart} nrcc.service"
      ;;
    macos)
      local plist_dir="$HOME/Library/LaunchAgents"
      mkdir -p "$plist_dir"
      local plist_file="$plist_dir/com.nrcc.app.plist"
      log "Writing $plist_file"
      sed -e "s|@LAUNCHER@|$INSTALL_DIR/bin/nrcc|g" \
          -e "s|@INSTALLDIR@|$INSTALL_DIR|g" \
          "$INSTALL_DIR/templates/com.nrcc.app.plist" > "$plist_file"
      launchctl unload "$plist_file" >/dev/null 2>&1 || true
      launchctl load -w "$plist_file"
      ok "Enabled. Manage with: launchctl {kickstart|bootout} gui/$UID com.nrcc.app"
      ;;
  esac
}

cmd_disable_service() {
  case "$PLATFORM" in
    linux)
      systemctl --user disable --now nrcc.service 2>/dev/null || true
      rm -f "$HOME/.config/systemd/user/nrcc.service"
      ok "Disabled."
      ;;
    macos)
      local plist_file="$HOME/Library/LaunchAgents/com.nrcc.app.plist"
      [[ -f "$plist_file" ]] && launchctl unload "$plist_file" >/dev/null 2>&1 || true
      rm -f "$plist_file"
      ok "Disabled."
      ;;
  esac
}

cmd_uninstall() {
  log "Stopping NRCC ..."
  cmd_stop || true
  cmd_disable_service || true

  case "$PLATFORM" in
    linux) rm -f "$HOME/.local/share/applications/nrcc.desktop" ;;
    macos) rm -f "$HOME/Applications/Launch NRCC.command" ;;
  esac

  # Best-effort: remove the launcher symlink wherever it lives.
  for d in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin"; do
    if [[ -L "$d/nrcc" ]]; then
      local tgt; tgt="$(readlink "$d/nrcc")"
      if [[ "$tgt" == "$INSTALL_DIR/bin/nrcc" ]]; then rm -f "$d/nrcc"; log "Removed $d/nrcc"; fi
    fi
  done

  log "Removing $INSTALL_DIR ..."
  rm -rf "$INSTALL_DIR"
  ok "Uninstalled."
  warn "PATH entries in your shell rc files are left in place; remove the 'Added by NRCC installer' block manually if you want."
}

cmd_help() {
  cat <<EOF
${c_bold}nrcc${c_reset} -- Nutanix Remote Console Client launcher

Usage: nrcc <command>

Commands:
  start              start NRCC (docker compose up -d, or background node)
  stop               stop NRCC
  restart            stop then start
  status             show whether NRCC is running
  logs               tail server logs
  open               open the browser to the NRCC URL (starts NRCC if needed)
  upgrade            pull a newer image (docker) or git pull + npm ci (source)
  enable-service     register autostart at login (systemd --user / launchd)
  disable-service    un-register autostart
  uninstall          stop, disable, and remove the install
  help               show this message

State:
  install dir = $INSTALL_DIR
  method      = $METHOD
  URL         = $URL

Run with no command = ${c_bold}start + open${c_reset}.
EOF
}

case "${1:-}" in
  ""|start-and-open) cmd_start && open_url "$URL" ;;
  start)            cmd_start ;;
  stop)             cmd_stop ;;
  restart)          cmd_restart ;;
  status)           cmd_status ;;
  logs|log)         cmd_logs ;;
  open)             cmd_open ;;
  upgrade|update)   cmd_upgrade ;;
  enable-service)   cmd_enable_service ;;
  disable-service)  cmd_disable_service ;;
  uninstall|remove) cmd_uninstall ;;
  help|-h|--help)   cmd_help ;;
  *) die "Unknown command: $1 (try 'nrcc help')" ;;
esac
