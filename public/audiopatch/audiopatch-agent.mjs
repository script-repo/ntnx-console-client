// NRCC AudioPatch VM agent (beta feature: audioPatch).
//
// Adapted from the CC-Peep audio bridge (https://github.com/script-repo/CC-Peep)
// to speak NRCC's AudioPatch portal protocol. Runs *inside the guest VM*
// and uses ffmpeg to move raw 16-bit little-endian PCM in/out of the
// machine:
//
//   output  capture the VM's system audio (a virtual audio cable / sink
//           monitor) -> NRCC -> the admin's browser.
//   input   the admin's microphone -> NRCC -> play into a sink/device on
//           the VM (Linux and Windows both supported).
//
// IDENTITY: the agent does NOT need a VM UUID. It reports its own MAC
// addresses, IPv4 addresses, hostname and (on Linux) DMI product UUID,
// and NRCC resolves the matching Prism VM UUID server-side from the VM
// inventory. Supply --uuid only to override that resolution.
//
// Wire protocol (matches server.js /ws-audiopatch/client):
//   1. connect to  wss://<nrcc-host>/ws-audiopatch/client?token=<token>
//   2. send  {type:"register", identity:{macs,ips,dmiUuid,hostname}, vmName, session, capabilities}
//   3. send  {type:"audio-format", direction:"output", sampleRate, channels, bitsPerSample}
//   4. stream raw PCM as binary WebSocket frames (output)
//   5. on {type:"input-format",...} + binary frames -> play them (input)
//   6. {type:"ping"} every 25s keeps the registry entry alive.
//
// Config: CLI flags override AUDIOPATCH_* env vars override defaults.
//   --portal   / AUDIOPATCH_PORTAL     wss://host/ws-audiopatch/client (required)
//   --token    / AUDIOPATCH_TOKEN      portal registration token (if the portal requires one)
//   --uuid     / AUDIOPATCH_VM_UUID    optional Prism VM UUID override (normally auto-resolved)
//   --name     / AUDIOPATCH_VM_NAME    display name (default: hostname)
//   --session  / AUDIOPATCH_SESSION    free-form label shown in PatchBay
//   --direction/ AUDIOPATCH_DIRECTION  output | input | both (default: output)
//   --rate     / AUDIOPATCH_RATE       PCM sample rate (default: 48000)
//   --os       / AUDIOPATCH_OS         linux | windows (default: auto-detect)
//   --capture-source   / AUDIOPATCH_CAPTURE_SOURCE   ffmpeg input device
//   --playback-sink    / AUDIOPATCH_PLAYBACK_SINK    ffmpeg output device (input direction)
//   --capture-format   / AUDIOPATCH_CAPTURE_FORMAT   ffmpeg -f for capture (pulse|alsa|dshow)
//   --playback-format  / AUDIOPATCH_PLAYBACK_FORMAT  ffmpeg -f for playback (pulse|alsa|dshow)
//   --ffmpeg   / AUDIOPATCH_FFMPEG     ffmpeg binary path (default: ffmpeg)
//   AUDIOPATCH_TLS_STRICT=1            verify TLS for wss:// (default: accept self-signed)

import os from "node:os";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";

// Prefer the 'ws' package (it can accept NRCC's self-signed wss:// via
// rejectUnauthorized:false). Fall back to the built-in WebSocket when ws
// isn't installed -- in that case we relax TLS process-wide so self-signed
// portals still connect.
let WebSocket = null;
let usingBuiltin = false;
try {
  ({ WebSocket } = await import("ws"));
} catch (_e) {
  if (globalThis.WebSocket) {
    WebSocket = globalThis.WebSocket;
    usingBuiltin = true;
  } else {
    console.error("[audiopatch] No WebSocket available. Install 'ws' (npm install ws) or run on Node >= 22.");
    process.exit(1);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const detectedOs = process.platform === "win32" ? "windows" : "linux";
const cfg = {
  portal: args.portal || process.env.AUDIOPATCH_PORTAL || "",
  token: args.token || process.env.AUDIOPATCH_TOKEN || "",
  vmUuid: (args.uuid || process.env.AUDIOPATCH_VM_UUID || "").toLowerCase(),
  vmName: args.name || process.env.AUDIOPATCH_VM_NAME || os.hostname(),
  session: args.session || process.env.AUDIOPATCH_SESSION || "",
  direction: args.direction || process.env.AUDIOPATCH_DIRECTION || "output",
  rate: parseInt(args.rate || process.env.AUDIOPATCH_RATE || "48000", 10),
  osType: args.os || process.env.AUDIOPATCH_OS || detectedOs,
  ffmpeg: args.ffmpeg || process.env.AUDIOPATCH_FFMPEG || "ffmpeg",
  captureSource: args["capture-source"] || process.env.AUDIOPATCH_CAPTURE_SOURCE || "",
  playbackSink: args["playback-sink"] || process.env.AUDIOPATCH_PLAYBACK_SINK || "",
  captureFormat: args["capture-format"] || process.env.AUDIOPATCH_CAPTURE_FORMAT || "",
  playbackFormat: args["playback-format"] || process.env.AUDIOPATCH_PLAYBACK_FORMAT || "",
};

// Per-OS defaults for ffmpeg backends/devices.
if (cfg.osType === "windows") {
  cfg.captureFormat ||= "dshow";
  // VB-CABLE exposes its output as a recording device "CABLE Output".
  cfg.captureSource ||= "audio=CABLE Output (VB-Audio Virtual Cable)";
} else {
  cfg.captureFormat ||= "pulse";
  cfg.playbackFormat ||= "pulse";
  // @DEFAULT_MONITOR@ captures whatever the VM is playing; the loopback
  // setup script can create a dedicated null sink + monitor instead.
  cfg.captureSource ||= "@DEFAULT_MONITOR@";
  cfg.playbackSink ||= "@DEFAULT_SINK@";
}

// Resolve the Linux Pulse/PipeWire placeholders to real device names so
// capture (monitor of the default sink) and playback (the default sink)
// work out of the box without --setup-audio. Explicit --capture-source /
// --playback-sink overrides are left untouched.
function resolveLinuxPulseDevices() {
  if (cfg.osType === "windows") return;
  const needsMonitor = cfg.captureSource === "@DEFAULT_MONITOR@";
  const needsSink = cfg.playbackSink === "@DEFAULT_SINK@";
  if (!needsMonitor && !needsSink) return;
  let defaultSink = "";
  try {
    const r = spawnSync("pactl", ["get-default-sink"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout) defaultSink = r.stdout.trim();
  } catch (_e) {
    // pactl missing; handled by the fallbacks below.
  }
  if (needsMonitor) {
    if (defaultSink) {
      cfg.captureSource = `${defaultSink}.monitor`;
    } else {
      // No pactl/server: capturing 'default' grabs the default *source*
      // (often a mic), not playback, but it lets the agent start.
      cfg.captureSource = "default";
      console.warn("[audiopatch] could not resolve default sink via pactl; capturing 'default' source. Install pulseaudio-utils / pipewire-pulse or pass --capture-source.");
    }
  }
  if (needsSink) {
    // ffmpeg's pulse muxer connects to the default sink regardless of the
    // trailing arg (it is the stream name), so an empty/default value is
    // safe; prefer the explicit default sink name when we know it.
    cfg.playbackSink = defaultSink || "default";
  }
}
resolveLinuxPulseDevices();

if (!cfg.portal) {
  console.error("[audiopatch] --portal (or AUDIOPATCH_PORTAL) is required, e.g. wss://nrcc.example/ws-audiopatch/client");
  process.exit(2);
}

// Gather everything the host knows about itself so NRCC can map us to a
// Prism VM UUID without an operator-supplied --uuid.
function gatherIdentity() {
  const ifaces = os.networkInterfaces();
  const macs = new Set();
  const ips = new Set();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.internal) continue;
      if (ni.mac && ni.mac !== "00:00:00:00:00:00") macs.add(String(ni.mac).toLowerCase());
      const family = ni.family === 4 || ni.family === "IPv4";
      if (family && ni.address && !ni.address.startsWith("169.254.")) ips.add(ni.address);
    }
  }
  let dmiUuid = "";
  try {
    if (process.platform === "linux") {
      dmiUuid = fs.readFileSync("/sys/class/dmi/id/product_uuid", "utf8").trim().toLowerCase();
    }
  } catch (_e) {
    // product_uuid is root-only on many distros; MAC/IP/hostname still resolve.
  }
  return { macs: [...macs], ips: [...ips], dmiUuid, hostname: os.hostname() };
}
const identity = gatherIdentity();

const wantOutput = cfg.direction === "output" || cfg.direction === "both";
const wantInput = cfg.direction === "input" || cfg.direction === "both";
const RECONNECT_MS = 3000;
let ws = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let capture = null;
let playback = null;

function log(...a) {
  console.info(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
}

function isOpen() {
  return ws && ws.readyState === 1; // 1 === OPEN for both ws and built-in WebSocket
}

function sendText(obj) {
  if (isOpen()) {
    try { ws.send(JSON.stringify(obj)); } catch (_e) { /* ignore */ }
  }
}

function sendBinary(chunk) {
  if (!isOpen()) return;
  try {
    ws.send(chunk);
  } catch (_e) {
    /* ignore */
  }
}

// output: capture device -> mono s16le @rate -> binary frames to NRCC.
function startCapture() {
  const a = ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", cfg.captureFormat];
  if (cfg.captureFormat === "alsa") a.push("-ar", String(cfg.rate), "-ac", "1");
  a.push("-i", cfg.captureSource, "-ac", "1", "-ar", String(cfg.rate), "-f", "s16le", "-");
  capture = spawn(cfg.ffmpeg, a);
  log(`output: capturing '${cfg.captureSource}' (${cfg.captureFormat}) -> ${cfg.rate}Hz mono 16-bit`);
  sendText({ type: "audio-format", direction: "output", sampleRate: cfg.rate, channels: 1, bitsPerSample: 16 });
  capture.stdout.on("data", (chunk) => sendBinary(chunk));
  capture.stderr.on("data", (d) => log("ffmpeg(capture):", d.toString().trim()));
  capture.on("error", (e) => log("output: failed to start ffmpeg:", e.message));
  capture.on("exit", (code) => { if (code) log(`output: ffmpeg exited (${code})`); });
}

// input: receive binary frames from NRCC -> play into a sink/device.
function startPlayback() {
  if (cfg.osType === "windows" && !cfg.playbackSink) {
    log("input: no --playback-sink configured on Windows; input audio will be dropped (see README).");
    return;
  }
  const fmt = cfg.playbackFormat || (cfg.osType === "windows" ? "dshow" : "pulse");
  const a = [
    "-hide_banner", "-loglevel", "error",
    "-f", "s16le", "-ar", String(cfg.rate), "-ac", "1", "-i", "-",
    "-f", fmt, cfg.playbackSink,
  ];
  playback = spawn(cfg.ffmpeg, a);
  log(`input: playback -> '${cfg.playbackSink}' (${fmt}, ${cfg.rate}Hz mono 16-bit)`);
  playback.stderr.on("data", (d) => log("ffmpeg(playback):", d.toString().trim()));
  playback.on("error", (e) => log("input: failed to start ffmpeg:", e.message));
  playback.on("exit", (code) => { if (code) log(`input: ffmpeg exited (${code})`); });
}

function writePlayback(data) {
  if (!playback || !playback.stdin.writable) return;
  const buf = Buffer.isBuffer(data)
    ? data
    : (data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer || data));
  playback.stdin.write(buf);
}

function stopMedia() {
  try { capture?.kill("SIGKILL"); } catch (_e) { /* ignore */ }
  try { playback?.kill("SIGKILL"); } catch (_e) { /* ignore */ }
  capture = null;
  playback = null;
}

function portalUrl() {
  if (!cfg.token) return cfg.portal;
  const sep = cfg.portal.includes("?") ? "&" : "?";
  return `${cfg.portal}${sep}token=${encodeURIComponent(cfg.token)}`;
}

function handleTextMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_e) { return; }
  if (msg.type === "registered") {
    log(`registered (key=${msg.vmUuid}, resolved=${msg.resolved ? "yes" : "not yet"})`);
    if (!msg.resolved) log("  NRCC has not matched this agent to a VM yet; it will bind automatically once an operator loads the VM list.");
  } else if (msg.type === "resolved") {
    log(`resolved to VM UUID ${msg.vmUuid}`);
  } else if (msg.type === "consumers") {
    log(`consumers: ${msg.listeners} listening, ${msg.inputSenders} sending`);
  } else if (msg.type === "input-format") {
    log(`input-format from admin: ${msg.format?.sampleRate}Hz x${msg.format?.channels}`);
  } else if (msg.type === "error") {
    log(`portal error: ${msg.error}`);
  }
}

function onOpen() {
  log("connected; registering with the AudioPatch portal");
  sendText({
    type: "register",
    vmUuid: cfg.vmUuid || undefined,
    vmName: cfg.vmName,
    session: cfg.session,
    identity,
    capabilities: { output: wantOutput, input: wantInput },
  });
  if (wantOutput) startCapture();
  if (wantInput) startPlayback();
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => sendText({ type: "ping" }), 25000);
}

function onClose(code) {
  log(`disconnected (${code}); retrying in ${RECONNECT_MS / 1000}s`);
  clearInterval(heartbeatTimer);
  stopMedia();
  scheduleReconnect();
}

function connect() {
  const url = portalUrl();
  log(`connecting to ${cfg.portal} (name=${cfg.vmName}, macs=${identity.macs.join(",") || "none"}, direction=${cfg.direction})`);

  if (usingBuiltin) {
    if (url.startsWith("wss:") && process.env.AUDIOPATCH_TLS_STRICT !== "1") {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => onOpen());
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") handleTextMessage(ev.data);
      else writePlayback(ev.data);
    });
    ws.addEventListener("close", (ev) => onClose(ev.code));
    ws.addEventListener("error", (ev) => log("ws error:", ev.message || "connection error"));
  } else {
    const opts = {};
    if (url.startsWith("wss:") && process.env.AUDIOPATCH_TLS_STRICT !== "1") {
      opts.rejectUnauthorized = false;
    }
    ws = new WebSocket(url, opts);
    ws.on("open", () => onOpen());
    ws.on("message", (data, isBinary) => {
      if (isBinary) writePlayback(data);
      else handleTextMessage(data.toString());
    });
    ws.on("close", (code) => onClose(code));
    ws.on("error", (err) => log("ws error:", err.message));
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, RECONNECT_MS);
}

function shutdown(reason) {
  log(`shutting down (${reason})`);
  clearInterval(heartbeatTimer);
  stopMedia();
  try { ws?.close(); } catch (_e) { /* ignore */ }
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

log("NRCC AudioPatch agent starting");
connect();
