#!/usr/bin/env bash
#
# NRCC AudioPatch -- Linux client installer (beta: audioPatch).
#
# Installs prerequisites checks, the Node agent dependencies, optional
# audio loopback setup, and a systemd *user* service that keeps the
# AudioPatch agent connected to the NRCC portal.
#
# Run inside the guest Linux VM (not on NRCC):
#   ./install-client.sh \
#     --portal wss://nrcc.example/ws-audiopatch/client \
#     --uuid   <prism-vm-uuid> \
#     --token  <portal-token-if-required> \
#     --direction both \
#     --setup-audio
#
# Flags (all optional except --portal and --uuid):
#   --portal URL       NRCC portal client endpoint (required)
#   --uuid UUID        Prism VM UUID; must match the NRCC VM list (required)
#   --token TOKEN      portal registration token (if NRCC_AUDIOPATCH_TOKEN is set)
#   --name NAME        display name in PatchBay (default: hostname)
#   --session LABEL    free-form session label
#   --direction DIR    output | input | both (default: output)
#   --rate HZ          PCM sample rate (default: 48000)
#   --setup-audio      run setup-linux-audio.sh to create the AudioPatch sink
#   --no-service       install/validate only; don't create the systemd service
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTAL="" UUID="" TOKEN="" NAME="" SESSION="" DIRECTION="output" RATE="48000"
DO_SETUP_AUDIO=0 NO_SERVICE=0

log()  { printf '[audiopatch-install] %s\n' "$*"; }
warn() { printf '[audiopatch-install] WARN: %s\n' "$*" >&2; }
fail() { printf '[audiopatch-install] ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --portal) PORTAL="$2"; shift 2;;
    --uuid) UUID="$2"; shift 2;;
    --token) TOKEN="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    --session) SESSION="$2"; shift 2;;
    --direction) DIRECTION="$2"; shift 2;;
    --rate) RATE="$2"; shift 2;;
    --setup-audio) DO_SETUP_AUDIO=1; shift;;
    --no-service) NO_SERVICE=1; shift;;
    *) fail "Unknown argument: $1";;
  esac
done

[ -n "${PORTAL}" ] || fail "--portal is required (e.g. wss://nrcc.example/ws-audiopatch/client)."
[ -n "${UUID}" ]   || fail "--uuid is required (the Prism VM UUID shown in NRCC's VM list)."
[ -n "${NAME}" ]   || NAME="$(hostname)"

# ---- Prerequisite checks ------------------------------------------------
log "Checking prerequisites..."
command -v node >/dev/null 2>&1 || fail "Node.js >= 18 is required. Install nodejs and re-run."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "${NODE_MAJOR}" -ge 18 ] || fail "Node.js >= 18 required (found $(node -v))."
command -v npm >/dev/null 2>&1 || fail "npm is required. Install it and re-run."
if command -v ffmpeg >/dev/null 2>&1; then
  log "ffmpeg: $(ffmpeg -version 2>/dev/null | head -n1)"
else
  fail "ffmpeg is required. Install it (apt install ffmpeg / dnf install ffmpeg) and re-run."
fi
command -v pactl >/dev/null 2>&1 || warn "pactl not found -- PulseAudio/PipeWire tools missing. Audio capture/playback may fail until installed."

# ---- Agent dependencies -------------------------------------------------
log "Installing agent dependencies (ws) in ${HERE}..."
( cd "${HERE}" && npm install --omit=dev --no-audit --no-fund )

# ---- Optional audio loopback setup -------------------------------------
CAPTURE_SOURCE="@DEFAULT_MONITOR@"
PLAYBACK_SINK="@DEFAULT_SINK@"
if [ "${DO_SETUP_AUDIO}" -eq 1 ]; then
  log "Setting up the AudioPatch null sink..."
  bash "${HERE}/setup-linux-audio.sh" AudioPatch
  CAPTURE_SOURCE="AudioPatch.monitor"
  PLAYBACK_SINK="AudioPatch"
fi

# ---- Validate the agent can be parsed/launched -------------------------
log "Validating the agent script..."
node --check "${HERE}/audiopatch-agent.mjs" || fail "Agent script failed syntax validation."

# ---- systemd user service ----------------------------------------------
if [ "${NO_SERVICE}" -eq 1 ]; then
  log "Skipping service install (--no-service). Run manually with:"
  echo "  AUDIOPATCH_PORTAL='${PORTAL}' AUDIOPATCH_VM_UUID='${UUID}' node '${HERE}/audiopatch-agent.mjs' --direction ${DIRECTION}"
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  warn "systemctl not available; cannot install a service. Run the agent manually (see README)."
  exit 0
fi

UNIT_DIR="${HOME}/.config/systemd/user"
mkdir -p "${UNIT_DIR}"
UNIT="${UNIT_DIR}/nrcc-audiopatch.service"
NODE_BIN="$(command -v node)"

log "Writing ${UNIT}"
cat > "${UNIT}" <<EOUNIT
[Unit]
Description=NRCC AudioPatch agent
After=network-online.target sound.target pipewire.service
Wants=network-online.target

[Service]
Type=simple
Environment=AUDIOPATCH_PORTAL=${PORTAL}
Environment=AUDIOPATCH_VM_UUID=${UUID}
Environment=AUDIOPATCH_VM_NAME=${NAME}
Environment=AUDIOPATCH_SESSION=${SESSION}
Environment=AUDIOPATCH_DIRECTION=${DIRECTION}
Environment=AUDIOPATCH_RATE=${RATE}
Environment=AUDIOPATCH_TOKEN=${TOKEN}
Environment=AUDIOPATCH_CAPTURE_SOURCE=${CAPTURE_SOURCE}
Environment=AUDIOPATCH_PLAYBACK_SINK=${PLAYBACK_SINK}
ExecStart=${NODE_BIN} ${HERE}/audiopatch-agent.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOUNIT

systemctl --user daemon-reload
systemctl --user enable --now nrcc-audiopatch.service

log "Service installed and started. Useful commands:"
echo "  systemctl --user status nrcc-audiopatch.service"
echo "  journalctl --user -u nrcc-audiopatch.service -f"
echo "  systemctl --user restart nrcc-audiopatch.service"
log "Tip: enable lingering so it runs without an active login: 'loginctl enable-linger ${USER}'"
