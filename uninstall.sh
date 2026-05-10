#!/usr/bin/env bash
# =====================================================================
# NRCC uninstaller (Linux + macOS).
#
# Convenience wrapper that calls `nrcc uninstall`. If `nrcc` isn't on
# PATH (e.g. the user removed the symlink themselves), it walks the
# default install location and runs the launcher directly.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/script-repo/ntnx-console-client/main/uninstall.sh | bash
# =====================================================================

set -euo pipefail

NRCC_INSTALL_DIR="${NRCC_INSTALL_DIR:-$HOME/.nrcc}"

c_reset=$'\033[0m'; c_red=$'\033[31m'; c_blu=$'\033[34m'
log() { printf "%s[NRCC]%s %s\n" "$c_blu" "$c_reset" "$*" >&2; }
die() { printf "%s[NRCC] ERROR:%s %s\n" "$c_red" "$c_reset" "$*" >&2; exit 1; }

if command -v nrcc >/dev/null 2>&1; then
  log "Running 'nrcc uninstall' ..."
  exec nrcc uninstall
fi

if [[ -x "$NRCC_INSTALL_DIR/bin/nrcc" ]]; then
  log "Running $NRCC_INSTALL_DIR/bin/nrcc uninstall ..."
  exec "$NRCC_INSTALL_DIR/bin/nrcc" uninstall
fi

die "Could not locate the nrcc launcher (expected at $NRCC_INSTALL_DIR/bin/nrcc).
Set NRCC_INSTALL_DIR=/path/to/install and re-run, or rm -rf the install directory by hand."
