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
//   --ffplay   / AUDIOPATCH_FFPLAY     ffplay binary path (Windows input playback; default: ffplay)
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
  ffplay: args.ffplay || process.env.AUDIOPATCH_FFPLAY || "ffplay",
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
  // @DEFAULT_MONITOR@ / @DEFAULT_SINK@ are sentinels meaning "auto-detect";
  // detectLinuxAudioBackend() picks PulseAudio/PipeWire or ALSA snd-aloop.
  cfg.captureSource ||= "@DEFAULT_MONITOR@";
  cfg.playbackSink ||= "@DEFAULT_SINK@";
  detectLinuxAudioBackend();
}

function pulseAvailable() {
  try {
    return spawnSync("pactl", ["info"], { encoding: "utf8" }).status === 0;
  } catch (_e) {
    return false;
  }
}

function defaultPulseSink() {
  try {
    const r = spawnSync("pactl", ["get-default-sink"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout) return r.stdout.trim();
  } catch (_e) { /* ignore */ }
  return "";
}

function alsaLoopbackPresent() {
  // Detect the snd-aloop card WITHOUT relying on alsa-utils: arecord/aplay
  // are absent on minimal/server installs (e.g. Rocky/RHEL base), but the
  // kernel always exposes /proc/asound/cards once ALSA + snd-aloop are
  // loaded. Relying on aplay here made the agent silently fall back to the
  // (nonexistent) Pulse server and capture nothing.
  try {
    if (/loopback/i.test(fs.readFileSync("/proc/asound/cards", "utf8"))) return true;
  } catch (_e) { /* ignore */ }
  for (const cmd of ["arecord", "aplay"]) {
    try {
      const r = spawnSync(cmd, ["-l"], { encoding: "utf8" });
      if (r.status === 0 && /Loopback/i.test(r.stdout || "")) return true;
    } catch (_e) { /* ignore */ }
  }
  return false;
}

// Pick a working ffmpeg backend/device for this Linux guest. Explicit
// --capture-source / --playback-sink (and --capture-format/--playback-format)
// always win; only the @...@ sentinels are auto-resolved.
function detectLinuxAudioBackend() {
  const autoCapture = cfg.captureSource === "@DEFAULT_MONITOR@";
  const autoSink = cfg.playbackSink === "@DEFAULT_SINK@";

  if (pulseAvailable()) {
    cfg.captureFormat ||= "pulse";
    cfg.playbackFormat ||= "pulse";
    const sink = defaultPulseSink();
    if (autoCapture) cfg.captureSource = sink ? `${sink}.monitor` : "default";
    if (autoSink) cfg.playbackSink = sink || "default";
    console.info(`[audiopatch] audio backend: pulse (capture='${cfg.captureSource}', playback='${cfg.playbackSink}')`);
    return;
  }

  if (alsaLoopbackPresent()) {
    cfg.captureFormat ||= "alsa";
    cfg.playbackFormat ||= "alsa";
    // snd-aloop pairs subdevice 0 (playback) with subdevice 1 (capture):
    // whatever is played to hw:Loopback,0 is captured from hw:Loopback,1.
    if (autoCapture) cfg.captureSource = "hw:Loopback,1,0";
    if (autoSink) cfg.playbackSink = "hw:Loopback,0,0";
    console.info(`[audiopatch] audio backend: alsa snd-aloop (capture='${cfg.captureSource}', playback='${cfg.playbackSink}')`);
    return;
  }

  // Nothing capturable: still start (input may work to the default device)
  // but make the silence diagnosable.
  cfg.captureFormat ||= "pulse";
  cfg.playbackFormat ||= "pulse";
  if (autoCapture) cfg.captureSource = "default";
  if (autoSink) cfg.playbackSink = "default";
  console.warn("[audiopatch] No PulseAudio/PipeWire server and no ALSA 'Loopback' card found.");
  console.warn("[audiopatch] OUTPUT capture will be SILENT until a capturable device exists. Re-run the installer with --setup-audio, or load the loopback once: sudo modprobe snd-aloop (persist in /etc/modules-load.d/snd-aloop.conf).");
}

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
  // Flow diagnostics: count captured bytes so a SILENT patch (no audio heard
  // in the browser) is easy to tell apart from a broken capture device.
  let capturedBytes = 0;
  capture.stdout.on("data", (chunk) => { capturedBytes += chunk.length; sendBinary(chunk); });
  capture.stderr.on("data", (d) => log("ffmpeg(capture):", d.toString().trim()));
  capture.on("error", (e) => log("output: failed to start ffmpeg:", e.message));
  capture.on("exit", (code) => { if (code) log(`output: ffmpeg exited (${code}) -- capture device '${cfg.captureSource}' may be wrong; see --setup-audio`); });
  // After a few seconds with zero captured bytes the device is producing no
  // audio -- almost always because nothing is playing to it. Tell the user
  // exactly how to test instead of leaving them with silence.
  setTimeout(() => {
    if (!capture) return;
    if (capturedBytes === 0) {
      log(`output: WARNING captured 0 bytes from '${cfg.captureSource}'. Nothing is playing to the capture device.`);
      if (cfg.captureFormat === "alsa") {
        log("output: test it (no alsa-utils needed):  ffmpeg -f lavfi -i sine=frequency=440:duration=5 -f alsa hw:Loopback,0,0");
        log("output: (any app that plays to the 'default' ALSA device is also captured)");
      } else if (cfg.captureFormat === "dshow") {
        log("output: play any audio on this VM to the default Playback device (CABLE Input) -- it is captured from CABLE Output.");
        log("output: confirm VB-CABLE is the default Playback device in Sound > Playback.");
      } else {
        log("output: test it with:  paplay /usr/share/sounds/alsa/Front_Center.wav   (audio must play to the default sink)");
      }
    } else {
      log(`output: capture healthy (${(capturedBytes / 1024).toFixed(0)} KB in first 6s).`);
    }
  }, 6000);
}

// input: receive binary frames from NRCC -> play into a sink/device.
//
// IMPORTANT: the playback device is opened LAZILY (on the first input frame)
// and released after a short idle gap. snd-aloop allows only one writer to
// hw:Loopback,0,0, so holding it open while no admin is talking would block
// the VM's own apps (and any test playback) from feeding the OUTPUT capture.
// In `both` mode the device is therefore free whenever input isn't actively
// flowing.
const PLAYBACK_IDLE_MS = Math.max(500, Number(process.env.AUDIOPATCH_PLAYBACK_IDLE_MS || 1500));
let playbackIdleTimer = null;

function startPlayback() {
  if (playback) return true;

  // Windows: ffmpeg has no audio OUTPUT muxer (its dshow device is capture
  // only), so admin->VM audio is rendered with ffplay, which plays to the
  // system DEFAULT playback device via SDL. Route a virtual-cable INPUT as
  // the default Playback device and point the VM's mic apps at that cable's
  // OUTPUT so they hear the operator. ffplay can't select a device, so
  // --playback-sink is informational on Windows.
  if (cfg.osType === "windows") {
    const a = [
      "-hide_banner", "-loglevel", "error", "-nodisp", "-autoexit",
      "-f", "s16le", "-ar", String(cfg.rate), "-ac", "1", "-i", "-",
    ];
    playback = spawn(cfg.ffplay, a, { stdio: ["pipe", "ignore", "pipe"] });
    log(`input: playback -> default Playback device via ffplay (${cfg.rate}Hz mono 16-bit).`);
    log("input: ensure your virtual-cable INPUT is the default Playback device, and the VM mic app uses that cable's OUTPUT.");
    playback.stderr.on("data", (d) => log("ffplay(playback):", d.toString().trim()));
    playback.on("error", (e) => {
      if (e && e.code === "ENOENT") {
        log("input: failed to start ffplay (not found). Re-run the installer so it fetches ffplay.exe, or pass --ffplay <path>.");
      } else {
        log("input: failed to start ffplay:", e.message);
      }
      playback = null;
    });
    playback.on("exit", (code) => {
      if (code) log(`input: ffplay exited (${code})`);
      playback = null;
    });
    return true;
  }

  const fmt = cfg.playbackFormat || "pulse";
  const a = [
    "-hide_banner", "-loglevel", "error",
    "-f", "s16le", "-ar", String(cfg.rate), "-ac", "1", "-i", "-",
    "-f", fmt, cfg.playbackSink,
  ];
  playback = spawn(cfg.ffmpeg, a);
  log(`input: playback -> '${cfg.playbackSink}' (${fmt}, ${cfg.rate}Hz mono 16-bit)`);
  playback.stderr.on("data", (d) => log("ffmpeg(playback):", d.toString().trim()));
  playback.on("error", (e) => log("input: failed to start ffmpeg:", e.message));
  playback.on("exit", (code) => {
    if (code) log(`input: ffmpeg exited (${code})`);
    playback = null;
  });
  return true;
}

function releasePlaybackIdle() {
  clearTimeout(playbackIdleTimer);
  playbackIdleTimer = null;
  if (playback) {
    try { playback.stdin.end(); } catch (_e) { /* ignore */ }
    try { playback.kill("SIGKILL"); } catch (_e) { /* ignore */ }
    playback = null;
    log(`input: idle ${PLAYBACK_IDLE_MS}ms -> released '${cfg.playbackSink}' (frees it for VM/output audio)`);
  }
}

function writePlayback(data) {
  if (!wantInput) return;
  if (!startPlayback()) return; // unsupported (e.g. Windows without a sink)
  if (!playback || !playback.stdin.writable) return;
  const buf = Buffer.isBuffer(data)
    ? data
    : (data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer || data));
  playback.stdin.write(buf);
  clearTimeout(playbackIdleTimer);
  playbackIdleTimer = setTimeout(releasePlaybackIdle, PLAYBACK_IDLE_MS);
}

function stopMedia() {
  clearTimeout(playbackIdleTimer);
  playbackIdleTimer = null;
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
  if (wantInput) log("input: playback device opened on demand (released when idle so it never blocks VM/output audio)");
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
