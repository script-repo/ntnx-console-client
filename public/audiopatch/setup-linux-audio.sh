#!/usr/bin/env bash
#
# NRCC AudioPatch -- Linux audio loopback preparation (beta: audioPatch).
#
# Prepares a guest Linux VM so the AudioPatch agent can:
#   * capture what the VM is "playing" (output direction), and
#   * play the admin's microphone into the VM (input direction).
#
# It creates a dedicated PulseAudio/PipeWire null sink named
# "AudioPatch" plus its monitor source, so the agent captures a clean,
# predictable device instead of @DEFAULT_MONITOR@. Re-running is safe.
#
# Works with both classic PulseAudio and PipeWire's pulse shim
# (pactl/pipewire-pulse). For ALSA-only hosts, see the README for the
# snd-aloop alternative.
#
# Usage:
#   ./setup-linux-audio.sh [sink-name]
# Environment:
#   AUDIOPATCH_SINK_NAME   override the null-sink name (default: AudioPatch)
set -euo pipefail

SINK_NAME="${1:-${AUDIOPATCH_SINK_NAME:-AudioPatch}}"

log() { printf '[audiopatch-setup] %s\n' "$*"; }
fail() { printf '[audiopatch-setup] ERROR: %s\n' "$*" >&2; exit 1; }

command -v pactl >/dev/null 2>&1 || fail "pactl not found. Install pulseaudio-utils (Debian/Ubuntu) or pipewire-pulse (Fedora/RHEL)."

if ! pactl info >/dev/null 2>&1; then
  fail "Cannot talk to a PulseAudio/PipeWire server. Start the user audio session first (systemctl --user start pipewire pipewire-pulse) and re-run."
fi

# Drop any previous AudioPatch sink so we don't stack duplicates.
EXISTING="$(pactl list short modules 2>/dev/null | awk -v s="sink_name=${SINK_NAME}" '$0 ~ s {print $1}')"
if [ -n "${EXISTING}" ]; then
  log "Removing existing '${SINK_NAME}' module(s): ${EXISTING}"
  for m in ${EXISTING}; do pactl unload-module "${m}" || true; done
fi

log "Creating null sink '${SINK_NAME}' (+ monitor '${SINK_NAME}.monitor')"
pactl load-module module-null-sink \
  sink_name="${SINK_NAME}" \
  sink_properties=device.description="${SINK_NAME}" >/dev/null

log "Created. Devices now available:"
pactl list short sinks   | sed 's/^/  sink:   /'
pactl list short sources | grep -i "${SINK_NAME}" | sed 's/^/  source: /' || true

cat <<EONOTE

Done. Point the AudioPatch agent at these devices:

  # output (VM audio -> admin): capture the new sink's monitor
  --capture-source ${SINK_NAME}.monitor --capture-format pulse

  # input (admin mic -> VM): play into the new sink (or @DEFAULT_SINK@)
  --playback-sink ${SINK_NAME} --playback-format pulse

Route the application(s) whose audio you want captured to the
"${SINK_NAME}" sink (pavucontrol -> Playback tab, or set it default with:
  pactl set-default-sink ${SINK_NAME}).
EONOTE
