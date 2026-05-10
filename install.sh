#!/usr/bin/env bash
# =====================================================================
# NRCC one-line installer (Linux + macOS).
# =====================================================================
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/script-repo/ntnx-console-client/main/install.sh | bash
#
# Optional environment overrides:
#   NRCC_INSTALL_DIR   default ~/.nrcc
#   NRCC_BIN_DIR       default ~/.local/bin (added to PATH if missing)
#   NRCC_BRANCH        default main          (which git ref to track for source mode)
#   NRCC_REPO          default https://github.com/script-repo/ntnx-console-client
#   NRCC_RAW           default https://raw.githubusercontent.com/script-repo/ntnx-console-client/$NRCC_BRANCH
#   NRCC_FORCE_METHOD  unset  (set to "docker" or "source" to skip auto-detect)
#   NRCC_PORT          default 8443         (host port the server listens on)
#   NRCC_NO_OPEN       unset  (set to 1 to skip launching the browser at the end)
#
# What this script does:
#   1. Detects Docker -- if present and working, sets up via docker compose.
#      Otherwise installs Node.js (or downloads a portable runtime) and
#      runs the server directly from a git checkout.
#   2. Drops a launcher named `nrcc` on PATH with start/stop/logs/open/upgrade subcommands.
#   3. Drops a desktop icon (`Launch NRCC`) so the user can click to start
#      the server and open the browser.
#   4. Starts NRCC and opens the default browser.
#
# Re-running the script is safe -- it upgrades in place.
# =====================================================================

set -euo pipefail

NRCC_INSTALL_DIR="${NRCC_INSTALL_DIR:-$HOME/.nrcc}"
NRCC_BIN_DIR="${NRCC_BIN_DIR:-$HOME/.local/bin}"
NRCC_BRANCH="${NRCC_BRANCH:-main}"
NRCC_REPO="${NRCC_REPO:-https://github.com/script-repo/ntnx-console-client}"
NRCC_RAW="${NRCC_RAW:-https://raw.githubusercontent.com/script-repo/ntnx-console-client/$NRCC_BRANCH}"
NRCC_PORT="${NRCC_PORT:-8443}"
NRCC_FORCE_METHOD="${NRCC_FORCE_METHOD:-}"

# ---- helpers --------------------------------------------------------

c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_dim=$'\033[2m'
c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_blu=$'\033[34m'

log()  { printf "%s[NRCC]%s %s\n"      "$c_blu"  "$c_reset" "$*" >&2; }
ok()   { printf "%s[NRCC]%s %s\n"      "$c_grn"  "$c_reset" "$*" >&2; }
warn() { printf "%s[NRCC]%s %s\n"      "$c_yel"  "$c_reset" "$*" >&2; }
die()  { printf "%s[NRCC] ERROR:%s %s\n" "$c_red" "$c_reset" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Linux*)  PLATFORM=linux ;;
  Darwin*) PLATFORM=macos ;;
  *) die "Unsupported OS: $(uname -s). Try the Windows installer (install.ps1) or install manually." ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) warn "Unrecognised architecture '$ARCH' -- proceeding anyway, downloads may fail." ;;
esac

log "Platform: $PLATFORM ($ARCH); install dir: $NRCC_INSTALL_DIR"

# ---- choose install method -----------------------------------------

choose_method() {
  if [[ -n "$NRCC_FORCE_METHOD" ]]; then
    echo "$NRCC_FORCE_METHOD"; return
  fi
  if have docker && docker info >/dev/null 2>&1; then
    echo docker
  else
    echo source
  fi
}

METHOD="$(choose_method)"
case "$METHOD" in
  docker) ok "Method: Docker (RDP works out of the box via guacd sidecar)" ;;
  source) ok "Method: source (Node.js); RDP needs a separate guacd install -- see README" ;;
  *)      die "NRCC_FORCE_METHOD must be 'docker' or 'source' (got '$METHOD')" ;;
esac

# ---- prep dirs ------------------------------------------------------

mkdir -p "$NRCC_INSTALL_DIR" "$NRCC_INSTALL_DIR/bin" "$NRCC_INSTALL_DIR/data" "$NRCC_BIN_DIR"

# ---- fetch a file from the repo, with curl-or-wget fallback --------

fetch() {
  local url="$1" dst="$2"
  if have curl; then
    curl -fsSL --retry 3 -o "$dst" "$url"
  elif have wget; then
    wget -qO "$dst" "$url"
  else
    die "Need curl or wget on PATH to download files."
  fi
}

# ---- download CLI launcher + templates ------------------------------

log "Fetching launcher and templates from $NRCC_RAW ..."
fetch "$NRCC_RAW/cli/bin/nrcc.sh" "$NRCC_INSTALL_DIR/bin/nrcc"
chmod +x "$NRCC_INSTALL_DIR/bin/nrcc"

fetch "$NRCC_RAW/public/assets/nrcc-logo.png" "$NRCC_INSTALL_DIR/icon.png"

mkdir -p "$NRCC_INSTALL_DIR/templates"
fetch "$NRCC_RAW/cli/templates/nrcc.service"      "$NRCC_INSTALL_DIR/templates/nrcc.service"
fetch "$NRCC_RAW/cli/templates/com.nrcc.app.plist" "$NRCC_INSTALL_DIR/templates/com.nrcc.app.plist"

# ---- write install.json (the launcher reads this to route commands) -

# Use python or printf -- avoid jq dependency
write_install_json() {
  cat > "$NRCC_INSTALL_DIR/install.json" <<JSON
{
  "method":      "$METHOD",
  "platform":    "$PLATFORM",
  "arch":        "$ARCH",
  "installDir":  "$NRCC_INSTALL_DIR",
  "binDir":      "$NRCC_BIN_DIR",
  "repo":        "$NRCC_REPO",
  "branch":      "$NRCC_BRANCH",
  "raw":         "$NRCC_RAW",
  "port":        "$NRCC_PORT",
  "url":         "https://localhost:$NRCC_PORT"
}
JSON
}
write_install_json

# ---- bootstrap: docker path -----------------------------------------

bootstrap_docker() {
  log "Writing $NRCC_INSTALL_DIR/docker-compose.yml ..."
  fetch "$NRCC_RAW/cli/templates/docker-compose.yml" "$NRCC_INSTALL_DIR/docker-compose.yml"
  # The compose file references PORT via an env var so the host
  # publish port follows NRCC_PORT.
  cat > "$NRCC_INSTALL_DIR/.env" <<ENV
NRCC_PORT=$NRCC_PORT
ENV

  log "Pulling images (this can take a minute on first install) ..."
  ( cd "$NRCC_INSTALL_DIR" && docker compose pull )

  log "Starting NRCC + guacd ..."
  ( cd "$NRCC_INSTALL_DIR" && docker compose up -d )
}

# ---- bootstrap: source path -----------------------------------------

ensure_node() {
  if have node; then
    local v
    v="$(node -v 2>/dev/null | sed 's/^v//;s/\..*//')"
    if [[ "$v" =~ ^[0-9]+$ ]] && [[ "$v" -ge 20 ]]; then
      ok "Found Node $(node -v) on PATH"
      echo "$(command -v node)"; return
    fi
  fi
  log "Node 20+ not found on PATH -- attempting bootstrap ..."

  # Try platform package managers (no sudo escalation; if they need sudo we
  # fall through to the portable tarball).
  if [[ "$PLATFORM" == macos ]] && have brew; then
    log "Installing Node 20 via Homebrew ..."
    brew install node@20 || warn "brew install failed -- trying portable runtime"
    if have node; then echo "$(command -v node)"; return; fi
  fi
  if [[ "$PLATFORM" == linux ]] && have apt-get && [[ "$(id -u)" -eq 0 ]]; then
    log "Installing Node 20 via NodeSource ..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || true
    apt-get install -y nodejs || true
    if have node; then echo "$(command -v node)"; return; fi
  fi

  # Portable Node runtime (no install perms required).
  log "Downloading portable Node 20 runtime to $NRCC_INSTALL_DIR/runtime ..."
  local node_ver=v20.18.0
  local node_arch="$ARCH"
  local tar_url="https://nodejs.org/dist/${node_ver}/node-${node_ver}-${PLATFORM/macos/darwin}-${node_arch}.tar.gz"
  rm -rf "$NRCC_INSTALL_DIR/runtime"
  mkdir -p "$NRCC_INSTALL_DIR/runtime"
  if ! fetch "$tar_url" "$NRCC_INSTALL_DIR/runtime/node.tar.gz"; then
    die "Could not download portable Node from $tar_url. Install Node 20+ manually and re-run."
  fi
  tar -xzf "$NRCC_INSTALL_DIR/runtime/node.tar.gz" -C "$NRCC_INSTALL_DIR/runtime"
  rm -f "$NRCC_INSTALL_DIR/runtime/node.tar.gz"
  local nodebin
  nodebin="$(find "$NRCC_INSTALL_DIR/runtime" -maxdepth 3 -type f -name node | head -n1)"
  [[ -x "$nodebin" ]] || die "Portable Node extraction failed (no node binary found)."
  ok "Portable Node ready: $nodebin"
  echo "$nodebin"
}

bootstrap_source() {
  local node_path
  node_path="$(ensure_node)"

  if [[ -d "$NRCC_INSTALL_DIR/app/.git" ]]; then
    log "Updating existing checkout ..."
    ( cd "$NRCC_INSTALL_DIR/app" && git fetch --depth 1 origin "$NRCC_BRANCH" && git reset --hard "origin/$NRCC_BRANCH" )
  else
    log "Cloning $NRCC_REPO (branch $NRCC_BRANCH) ..."
    rm -rf "$NRCC_INSTALL_DIR/app"
    if have git; then
      git clone --depth 1 --branch "$NRCC_BRANCH" "$NRCC_REPO" "$NRCC_INSTALL_DIR/app"
    else
      log "git not found -- downloading tarball instead"
      mkdir -p "$NRCC_INSTALL_DIR/app"
      fetch "$NRCC_REPO/archive/refs/heads/$NRCC_BRANCH.tar.gz" "$NRCC_INSTALL_DIR/app.tar.gz"
      tar -xzf "$NRCC_INSTALL_DIR/app.tar.gz" -C "$NRCC_INSTALL_DIR/app" --strip-components=1
      rm -f "$NRCC_INSTALL_DIR/app.tar.gz"
    fi
  fi

  log "Installing npm dependencies (production only) ..."
  local npm_path
  npm_path="$(dirname "$node_path")/npm"
  ( cd "$NRCC_INSTALL_DIR/app" && PATH="$(dirname "$node_path"):$PATH" "$npm_path" ci --omit=dev --no-audit --no-fund )

  # Record paths the launcher needs in install.json.
  cat > "$NRCC_INSTALL_DIR/install.json" <<JSON
{
  "method":      "source",
  "platform":    "$PLATFORM",
  "arch":        "$ARCH",
  "installDir":  "$NRCC_INSTALL_DIR",
  "binDir":      "$NRCC_BIN_DIR",
  "repo":        "$NRCC_REPO",
  "branch":      "$NRCC_BRANCH",
  "raw":         "$NRCC_RAW",
  "port":        "$NRCC_PORT",
  "url":         "https://localhost:$NRCC_PORT",
  "nodePath":    "$node_path",
  "appDir":      "$NRCC_INSTALL_DIR/app"
}
JSON

  # Start via the launcher so PID + log handling is consistent.
  log "Starting NRCC ..."
  "$NRCC_INSTALL_DIR/bin/nrcc" start
}

case "$METHOD" in
  docker) bootstrap_docker ;;
  source) bootstrap_source ;;
esac

# ---- expose launcher on PATH ---------------------------------------

if [[ -L "$NRCC_BIN_DIR/nrcc" || -e "$NRCC_BIN_DIR/nrcc" ]]; then
  rm -f "$NRCC_BIN_DIR/nrcc"
fi
ln -s "$NRCC_INSTALL_DIR/bin/nrcc" "$NRCC_BIN_DIR/nrcc"
ok "Launcher installed: $NRCC_BIN_DIR/nrcc"

# Add NRCC_BIN_DIR to PATH in the user's shell rc if it isn't already.
add_path_to_rc() {
  local rc="$1"
  [[ -f "$rc" ]] || return 0
  if ! grep -qsE "PATH.*$NRCC_BIN_DIR" "$rc"; then
    {
      echo ""
      echo "# Added by NRCC installer"
      echo "export PATH=\"$NRCC_BIN_DIR:\$PATH\""
    } >> "$rc"
    log "Added $NRCC_BIN_DIR to PATH in $rc (reload your shell to pick it up)"
  fi
}
case ":$PATH:" in
  *":$NRCC_BIN_DIR:"*) ;;  # already on PATH for this shell
  *)
    add_path_to_rc "$HOME/.bashrc"
    add_path_to_rc "$HOME/.zshrc"
    add_path_to_rc "$HOME/.profile"
    ;;
esac

# ---- desktop icon --------------------------------------------------

install_icon_linux() {
  local apps_dir="$HOME/.local/share/applications"
  mkdir -p "$apps_dir"
  log "Fetching Linux .desktop launcher ..."
  fetch "$NRCC_RAW/cli/templates/nrcc.desktop" "$apps_dir/nrcc.desktop.tmpl"
  sed -e "s|@LAUNCHER@|$NRCC_INSTALL_DIR/bin/nrcc|g" \
      -e "s|@ICON@|$NRCC_INSTALL_DIR/icon.png|g" \
      "$apps_dir/nrcc.desktop.tmpl" > "$apps_dir/nrcc.desktop"
  rm -f "$apps_dir/nrcc.desktop.tmpl"
  chmod +x "$apps_dir/nrcc.desktop"
  # Refresh menus where the desktop environment supports it; non-fatal.
  if have update-desktop-database; then
    update-desktop-database "$apps_dir" >/dev/null 2>&1 || true
  fi
  ok "Desktop launcher: $apps_dir/nrcc.desktop"
}

install_icon_macos() {
  local apps_dir="$HOME/Applications"
  mkdir -p "$apps_dir"
  log "Fetching macOS .command launcher ..."
  fetch "$NRCC_RAW/cli/templates/nrcc.command" "$apps_dir/Launch NRCC.command.tmpl"
  sed -e "s|@LAUNCHER@|$NRCC_INSTALL_DIR/bin/nrcc|g" \
      "$apps_dir/Launch NRCC.command.tmpl" > "$apps_dir/Launch NRCC.command"
  rm -f "$apps_dir/Launch NRCC.command.tmpl"
  chmod +x "$apps_dir/Launch NRCC.command"
  ok "Desktop launcher: $apps_dir/Launch NRCC.command (double-click to start + open)"
}

case "$PLATFORM" in
  linux) install_icon_linux ;;
  macos) install_icon_macos ;;
esac

# ---- open browser --------------------------------------------------

if [[ -z "${NRCC_NO_OPEN:-}" ]]; then
  log "Waiting for NRCC to come up on https://localhost:$NRCC_PORT ..."
  # Wait up to ~30s; the server prints "running at" once ready.
  for _ in $(seq 1 30); do
    if (echo > /dev/tcp/127.0.0.1/$NRCC_PORT) >/dev/null 2>&1; then break; fi
    sleep 1
  done
  log "Opening browser ..."
  if [[ "$PLATFORM" == macos ]]; then
    open "https://localhost:$NRCC_PORT" || true
  else
    if have xdg-open; then xdg-open "https://localhost:$NRCC_PORT" >/dev/null 2>&1 || true
    else warn "xdg-open not available -- visit https://localhost:$NRCC_PORT manually"
    fi
  fi
fi

cat <<EOF

${c_grn}${c_bold}NRCC is installed.${c_reset}

  URL:           https://localhost:$NRCC_PORT
  Install dir:   $NRCC_INSTALL_DIR
  Method:        $METHOD
  Launcher:      $NRCC_BIN_DIR/nrcc

Common commands:
  ${c_bold}nrcc${c_reset}              start (if needed) and open the browser
  ${c_bold}nrcc start${c_reset}        start the server
  ${c_bold}nrcc stop${c_reset}         stop it
  ${c_bold}nrcc status${c_reset}       is it running?
  ${c_bold}nrcc logs${c_reset}         tail server logs
  ${c_bold}nrcc upgrade${c_reset}      pull a newer version
  ${c_bold}nrcc enable-service${c_reset}   register autostart at login
  ${c_bold}nrcc uninstall${c_reset}    stop everything and remove the install

${c_dim}First-load tip: the TLS cert is self-signed; click through the
browser warning once and the cert is then cached.${c_reset}
EOF
