#!/usr/bin/env bash
#
# NRCC AudioPatch -- Linux audio preparation (beta: audioPatch).
#
# Prepares a guest Linux VM so the AudioPatch agent can:
#   * capture what the VM is "playing" (output direction), and
#   * play the admin's microphone into the VM (input direction).
#
# Two backends are supported, auto-selected by what the guest has:
#
#   PulseAudio / PipeWire (pactl works): create a dedicated "AudioPatch"
#       null sink + monitor and make it the default sink, so everything the
#       VM plays is captured cleanly.
#
#   ALSA only (no Pulse server, e.g. a headless server VM): load the
#       snd-aloop kernel loopback (needs root once) and write ~/.asoundrc so
#       the default device routes through hw:Loopback. The agent then
#       captures hw:Loopback,1,0. This is the case this script handles when
#       pactl is missing or no server is running.
#
# Re-running is safe.
#
# Usage:
#   ./setup-linux-audio.sh [sink-name]
# Environment:
#   AUDIOPATCH_SINK_NAME   override the null-sink name (default: AudioPatch)
set -euo pipefail

SINK_NAME="${1:-${AUDIOPATCH_SINK_NAME:-AudioPatch}}"

log() { printf '[audiopatch-setup] %s\n' "$*"; }
warn() { printf '[audiopatch-setup] WARN: %s\n' "$*" >&2; }
fail() { printf '[audiopatch-setup] ERROR: %s\n' "$*" >&2; exit 1; }

# Run a command as root: direct if already root, else sudo -n, else print it.
as_root() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo "$@"
  else
    return 97
  fi
}

# -------- PulseAudio / PipeWire path --------------------------------------
if command -v pactl >/dev/null 2>&1 && pactl info >/dev/null 2>&1; then
  log "PulseAudio/PipeWire detected; configuring null sink '${SINK_NAME}'."

  EXISTING="$(pactl list short modules 2>/dev/null | awk -v s="sink_name=${SINK_NAME}" '$0 ~ s {print $1}')"
  if [ -n "${EXISTING}" ]; then
    log "Removing existing '${SINK_NAME}' module(s): ${EXISTING}"
    for m in ${EXISTING}; do pactl unload-module "${m}" || true; done
  fi

  log "Creating null sink '${SINK_NAME}' (+ monitor '${SINK_NAME}.monitor')"
  pactl load-module module-null-sink \
    sink_name="${SINK_NAME}" \
    sink_properties=device.description="${SINK_NAME}" >/dev/null

  # Make it the default so VM audio is captured without per-app routing.
  pactl set-default-sink "${SINK_NAME}" 2>/dev/null || true

  log "Created. Sinks/sources now available:"
  pactl list short sinks   | sed 's/^/  sink:   /'
  pactl list short sources | grep -i "${SINK_NAME}" | sed 's/^/  source: /' || true

  cat <<EONOTE

Done (PulseAudio/PipeWire). The agent auto-detects this; it captures
'${SINK_NAME}.monitor' and plays input into '${SINK_NAME}'. Restart it:
  systemctl --user restart nrcc-audiopatch
EONOTE
  exit 0
fi

# -------- ALSA snd-aloop fallback -----------------------------------------
log "No PulseAudio/PipeWire server; setting up the ALSA snd-aloop loopback."

if ! lsmod 2>/dev/null | grep -q '^snd_aloop'; then
  log "Loading kernel module snd-aloop ..."
  if ! as_root modprobe snd-aloop; then
    fail "Could not load snd-aloop (need root). Run once as root:
    sudo modprobe snd-aloop
    echo snd-aloop | sudo tee /etc/modules-load.d/snd-aloop.conf
  then re-run this script (or the installer with --setup-audio)."
  fi
fi

# Persist the module across reboots (best-effort).
if [ ! -f /etc/modules-load.d/snd-aloop.conf ]; then
  if ! as_root sh -c 'echo snd-aloop > /etc/modules-load.d/snd-aloop.conf'; then
    warn "Could not persist snd-aloop; it may need reloading after reboot."
  fi
fi

# Route the default ALSA device through the loopback so anything the VM
# plays on 'default' lands on hw:Loopback,0 and is captured from
# hw:Loopback,1. Back up any existing ~/.asoundrc once.
ASOUND="${HOME}/.asoundrc"
if [ -f "${ASOUND}" ] && ! grep -q 'AudioPatch snd-aloop' "${ASOUND}"; then
  cp "${ASOUND}" "${ASOUND}.nrcc-backup.$(date +%s)" || true
fi
cat > "${ASOUND}" <<'EOF'
# AudioPatch snd-aloop routing (managed by setup-linux-audio.sh)
pcm.!default {
    type plug
    slave.pcm "hw:Loopback,0,0"
}
ctl.!default {
    type hw
    card Loopback
}
EOF

log "Loopback ready. Devices:"
aplay -l 2>/dev/null | grep -i loopback | sed 's/^/  /' || true

cat <<EONOTE

Done (ALSA snd-aloop). The agent auto-detects this; it captures
'hw:Loopback,1,0' and plays input into 'hw:Loopback,0,0'.

Whatever the VM plays via the default device is now captured. Test it:
  systemctl --user restart nrcc-audiopatch
  speaker-test -D default -c2 -twav   # then Patch In 'Output' from NRCC
EONOTE
