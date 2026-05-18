const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");
const child_process = require("child_process");
const express = require("express");
const axios = require("axios");
const { WebSocketServer, WebSocket } = require("ws");
require("dotenv").config();

// Build identifier follows Major.Minor.Patch-YYYYMMDD-NN where the
// trailing -NN is the daily build counter (01, 02, ...). The bumper
// writes the same string to two places:
//   1. ./build.info  - single line, what the GitHub repo carries so
//                      the in-app updater can read it without git.
//   2. package.json   - canonical npm metadata.
// We prefer build.info because it's the file the updater swaps; if
// it's missing (older installs / stripped tarballs) we fall back to
// package.json, then to a 0.0.0 placeholder.
function loadAppVersion() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "build.info"), "utf8");
    const trimmed = String(raw).split(/\r?\n/)[0].trim();
    if (trimmed) return trimmed;
  } catch (_e) { /* fall through to package.json */ }
  try { return String(require("./package.json").version || "0.0.0"); }
  catch (_e) { return "0.0.0"; }
}
// Cached at startup for stable logs / API consistency, but the
// /api/config handler will refresh from build.info on every call so a
// `kubectl cp build.info ...` (or any out-of-band file swap) shows
// up in the UI footer without a node restart. The constant is still
// used everywhere else so log lines remain stable for a given run.
const APP_VERSION = loadAppVersion();

const app = express();
const port = Number(process.env.PORT || 3000);
const wsProxySessions = new Map();
const vmListVariantCache = new Map();
const VM_INVENTORY_CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.NRCC_VM_INVENTORY_CACHE_TTL_MS || 30_000)
);
const VM_INVENTORY_PAGE_SIZE = Math.max(
  100,
  Number(process.env.NRCC_VM_INVENTORY_PAGE_SIZE || 200)
);
const vmInventoryCache = new Map();
const vmInventoryEnrichmentJobs = new Map();

// =====================================================================
// Multi-user deployment configuration. The default (false) preserves
// the original single-user HTTP behaviour byte-for-byte; setting
// NRCC_MULTI_USER=true enables HTTPS, the chat WebSocket, and the
// chat UI in the browser.
// =====================================================================
const MULTI_USER_MODE = String(process.env.NRCC_MULTI_USER || "").toLowerCase() === "true";
const TLS_CERT_DIR = path.resolve(process.env.NRCC_TLS_CERT_DIR || "./certs");
const TLS_CERT_PATH_ENV = process.env.NRCC_TLS_CERT || "";
const TLS_KEY_PATH_ENV = process.env.NRCC_TLS_KEY || "";
const CHAT_BUFFER_SIZE = Math.max(10, Number(process.env.NRCC_CHAT_BUFFER || 200));
const SCREENSHOTS_DIR = path.resolve(process.env.NRCC_SCREENSHOTS_DIR || "./screenshots");
const SCREENSHOT_MAX_PER_VM = Math.max(1, Number(process.env.NRCC_SCREENSHOT_MAX_PER_VM || 100));
const RECORDINGS_DIR = path.resolve(process.env.NRCC_RECORDINGS_DIR || "./recordings");
const RECORDING_FPS = Math.max(1, Math.min(60, Number(process.env.NRCC_RECORDING_FPS || 10)));
const RECORDING_BITRATE = Math.max(50_000, Number(process.env.NRCC_RECORDING_BITRATE || 600_000));
const RECORDING_MAX_BYTES = Math.max(
  1_000_000,
  Number(process.env.NRCC_RECORDING_MAX_BYTES || 524_288_000)
);
const RECORDING_MAX_PER_VM = Math.max(1, Number(process.env.NRCC_RECORDING_MAX_PER_VM || 50));
const SCRIPTS_DIR = path.resolve(process.env.NRCC_SCRIPTS_DIR || "./scripts");
const SCRIPT_MAX_BYTES = Math.max(1024, Number(process.env.NRCC_SCRIPT_MAX_BYTES || 262_144));

// Activity logging. Disabled by default; an operator opts the
// deployment in by setting NRCC_LOGGING=true. Per-user opt-in still
// applies on top of that for client-emitted events (the request must
// carry ?clientLogging=1). Server-emitted events (login, console-open,
// console-close) always write when the master switch is on.
const LOGGING_ENABLED = String(process.env.NRCC_LOGGING || "").toLowerCase() === "true";
const LOGS_DIR = path.resolve(process.env.NRCC_LOGS_DIR || "./logs");

// Default retention in days for the weekly log files. Files older
// than this (by mtime) are deleted by the periodic sweep. The value
// can be overridden at runtime via the SERVER section of the
// Settings dialog (persisted to <SERVER_CONFIG_PATH>) -- the env var
// only sets the default that ships with a fresh deployment. A value
// of 0 disables pruning entirely (keep forever).
const LOG_RETENTION_DAYS_DEFAULT = Math.max(
  0,
  Number.isFinite(Number(process.env.NRCC_LOG_RETENTION_DAYS))
    ? Number(process.env.NRCC_LOG_RETENTION_DAYS)
    : 30
);
const LOG_RETENTION_DAYS_MAX = 3650; // ten years; clamps any UI mistake

// Server-wide persistent config. Anything that an operator may want
// to tweak post-deploy without redeploying lives here. The file is
// written next to the data dirs (so it survives pod restarts on the
// same PVC) and is loaded once at startup, then re-loaded on every
// PUT /api/server-config. We store ONLY values that the env var
// defaults can be overridden by; the env var remains the source of
// the initial value if the file doesn't exist yet.
const SERVER_CONFIG_PATH = path.resolve(
  process.env.NRCC_SERVER_CONFIG_PATH ||
    path.join(path.dirname(LOGS_DIR), "nrcc-server-config.json")
);

// In-app updater configuration. Defaults point at the canonical public
// repo so a fresh install can self-update out of the box; an operator
// can pin a fork or a feature branch via env, or disable the feature
// entirely with NRCC_UPDATE_ENABLED=false.
const UPDATE_ENABLED = String(process.env.NRCC_UPDATE_ENABLED || "true").toLowerCase() !== "false";
const UPDATE_REPO    = process.env.NRCC_UPDATE_REPO   || "https://github.com/script-repo/ntnx-console-client";
const UPDATE_BRANCH  = process.env.NRCC_UPDATE_BRANCH || "main";
// Items the file-swap path must NEVER overwrite. Anything user-data,
// secrets, or operator-installed runtime that we'd otherwise clobber
// when copying the cloned tree over the install dir. build.info is
// in the list because the upgrade rewrites it AFTER the swap so we
// always end up reflecting the version actually on disk.
const UPDATE_PRESERVE = new Set([
  "logs",
  "recordings",
  "screenshots",
  "scripts",
  "certs",
  "node_modules",
  ".env",
  "build.info"
]);
// Whitelist for client-supplied event types so the log file stays
// human-readable. Anything not in this set is normalised to
// "client.unknown" and the original type is moved into details.
const CLIENT_LOG_EVENT_TYPES = new Set([
  "console.paste",
  "console.ctrl-alt-del",
  "console.screenshot",
  "console.recording.start",
  "console.recording.stop",
  "console.script.copy",
  "settings.saved",
  "chat.send",
  "console.ssh.open",
  "console.ssh.close",
  "console.rdp.open",
  "console.rdp.close"
]);

// =====================================================================
// VM port-scan probe (beta feature: vmPortScan)
// =====================================================================
//
// After the VM list arrives the client batches the VM IPs to
// /api/probe/ports; the server TCP-dials each (vm, ip, port) tuple
// (typically 22 + 3389) and caches the result. The cache is also
// the SSRF guard for /api/ssh/start: an SSH session can only be
// opened against an IP that the probe just observed for that VM.
const PROBE_ENABLED = String(process.env.NRCC_PROBE_ENABLED || "true").toLowerCase() !== "false";
const PROBE_PORTS = String(process.env.NRCC_PROBE_PORTS || "22,3389")
  .split(",").map((s) => Number(String(s).trim())).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
const PROBE_TIMEOUT_MS = Math.max(250, Number(process.env.NRCC_PROBE_TIMEOUT_MS || 2000));
const PROBE_CONCURRENCY = Math.max(1, Number(process.env.NRCC_PROBE_CONCURRENCY || 20));
const PROBE_CACHE_TTL_MS = Math.max(15_000, Number(process.env.NRCC_PROBE_CACHE_TTL_MS || 120_000));
const PROBE_MAX_IPS_PER_VM = Math.max(1, Number(process.env.NRCC_PROBE_MAX_IPS_PER_VM || 4));

// =====================================================================
// SSH browser console (beta feature: sshConsole)
// =====================================================================
//
// POST /api/ssh/start authorises a session (validates host against the
// probe cache) and stores credentials in memory; the WS upgrade at
// /ws-ssh/<id> opens the actual ssh2.Client.shell() and pipes it to
// the browser's xterm.js terminal. Sessions auto-expire after
// NRCC_SSH_IDLE_TIMEOUT_MS of inactivity.
const SSH_ENABLED = String(process.env.NRCC_SSH_ENABLED || "true").toLowerCase() !== "false";
const SSH_IDLE_TIMEOUT_MS = Math.max(60_000, Number(process.env.NRCC_SSH_IDLE_TIMEOUT_MS || 15 * 60 * 1000));
const SSH_MAX_SESSIONS = Math.max(1, Number(process.env.NRCC_SSH_MAX_SESSIONS || 64));
const SSH_READY_TIMEOUT_MS = Math.max(5_000, Number(process.env.NRCC_SSH_READY_TIMEOUT_MS || 15_000));

// =====================================================================
// RDP browser console (beta feature: rdpConsole)
// =====================================================================
//
// POST /api/rdp/start authorises a session (validates host against the
// probe cache, same SSRF guard as SSH) and stores credentials in
// memory. The WS upgrade at /ws-rdp/<id> opens a TCP connection to a
// locally-installed `guacd` (the Apache Guacamole proxy daemon),
// performs the Guacamole protocol handshake using the stored creds,
// and then pipes raw Guacamole protocol bytes between the daemon and
// the browser's guacamole-common-js client. Browser → server bytes
// carry mouse / keyboard / clipboard / size; server → browser bytes
// carry rendering instructions. The browser composites those into a
// canvas, which the existing screenshot + recording pipelines then
// read from.
//
// guacd is NOT bundled. Operators install it natively via their OS
// package manager (apt install guacd / dnf install guacd /
// brew install guacamole-server). The README documents this as part
// of the beta opt-in. We deliberately do NOT add a docker dependency.
const RDP_ENABLED = String(process.env.NRCC_RDP_ENABLED || "true").toLowerCase() !== "false";
const RDP_IDLE_TIMEOUT_MS = Math.max(60_000, Number(process.env.NRCC_RDP_IDLE_TIMEOUT_MS || 15 * 60 * 1000));
const RDP_MAX_SESSIONS = Math.max(1, Number(process.env.NRCC_RDP_MAX_SESSIONS || 64));
const GUACD_HOST = String(process.env.NRCC_GUACD_HOST || "127.0.0.1").trim();
const GUACD_PORT = Math.max(1, Math.min(65535, Number(process.env.NRCC_GUACD_PORT || 4822)));
const GUACD_CONNECT_TIMEOUT_MS = Math.max(2_000, Number(process.env.NRCC_GUACD_CONNECT_TIMEOUT_MS || 15_000));
// Default display dimensions for the RDP canvas. The client overrides
// these in /api/rdp/start with the actual screen pane size, but we
// keep sane defaults for any client that forgets to send them.
const RDP_DEFAULT_WIDTH = Math.max(640, Math.min(4096, Number(process.env.NRCC_RDP_WIDTH || 1280)));
const RDP_DEFAULT_HEIGHT = Math.max(480, Math.min(4096, Number(process.env.NRCC_RDP_HEIGHT || 800)));
const RDP_DEFAULT_DPI = Math.max(72, Math.min(192, Number(process.env.NRCC_RDP_DPI || 96)));
// "any" lets guacd negotiate. Override with rdp / nla / tls / vmconnect
// for hosts that mis-advertise.
const RDP_SECURITY = String(process.env.NRCC_RDP_SECURITY || "any").trim().toLowerCase();
// Lab default: skip server certificate verification. Operators with a
// PKI in place should set NRCC_RDP_IGNORE_CERT=false.
const RDP_IGNORE_CERT = String(process.env.NRCC_RDP_IGNORE_CERT || "true").toLowerCase() !== "false";

// =====================================================================
// VM folders (beta feature: vmFolders)
// =====================================================================
//
// Group VMs into folders backed by Prism categories under the
// reserved key "NTNXFolderPath" (dot-delimited paths, e.g.
// "Production.Linux.Web"). Reads come for free off the categories
// array that parseVmList already attaches to every VM; writes go
// back to Prism via v4 category-association with a v3 metadata-PUT
// fallback. Disable with NRCC_VM_FOLDERS_ENABLED=false on locked-
// down installs that don't want NRCC mutating cluster category
// state.
const VM_FOLDERS_ENABLED = String(process.env.NRCC_VM_FOLDERS_ENABLED || "true").toLowerCase() !== "false";

// =====================================================================
// Feature-flag registry
// =====================================================================
//
// Every visible feature (existing or planned) declares a stage of
// "ga" or "beta". GA features are always available; beta features
// only render in the UI when the user has opted in via Settings ->
// Show beta features. To promote a feature to GA, change its stage
// to "ga" here. The client mirrors this object via /api/config.
const FEATURE_FLAGS = {
  chat:        { stage: "ga", description: "Multi-user VM chat panel" },
  screenshots: { stage: "ga", description: "Per-VM screenshot capture and library" },
  recordings:  { stage: "ga", description: "Per-VM video recording (10 fps WebM)" },
  scripts:     { stage: "ga", description: "Global script library with click-to-clipboard" },
  logging:     { stage: "ga", description: "Optional activity logging (server-gated)" },
  settings:    { stage: "ga", description: "User preferences dialog (theme, idle timeout)" },
  // Beta features. UI is hidden via [data-feature="<id>"] gating until
  // the user toggles "Show beta features" in Settings AND the server
  // has them enabled (NRCC_PROBE_ENABLED / NRCC_SSH_ENABLED /
  // NRCC_RDP_ENABLED).
  vmPortScan:  { stage: "beta", description: "Auto-probe VM IPs for SSH/RDP availability" },
  sshConsole:  { stage: "beta", description: "Open SSH session as a console tab (xterm.js)" },
  rdpConsole:  { stage: "beta", description: "Open RDP session as a console tab (Guacamole HTML5; needs guacd)" },
  vmFolders:   { stage: "beta", description: "Group VMs into Prism-category-backed folders (NTNXFolderPath)" }
};

// Strict UUID match used everywhere we accept a VM UUID from the client.
// Lowercase and hyphenated, no curly braces, no upper-case (the server
// side normalises to lowercase before any filesystem use).
const VM_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ensure the asset directories exist at boot. Doing this once here
// means individual writes only have to mkdir per-VM / per-folder subdirs.
for (const [label, dir] of [
  ["screenshots", SCREENSHOTS_DIR],
  ["recordings", RECORDINGS_DIR],
  ["scripts", SCRIPTS_DIR]
]) {
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (err) { console.warn(`[${label}] could not create ${dir}: ${err.message}`); }
}
// Recordings need a temp area for in-flight chunked uploads.
try { fs.mkdirSync(path.join(RECORDINGS_DIR, "_tmp"), { recursive: true }); }
catch (err) { console.warn(`[recordings] could not create _tmp: ${err.message}`); }
// Logs dir is only created when logging is actually enabled, so the
// "logs/" directory doesn't appear on disk for deployments that
// haven't opted in.
if (LOGGING_ENABLED) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    console.log(`[logging] activity logs enabled (dir: ${LOGS_DIR})`);
  } catch (err) {
    console.warn(`[logging] could not create ${LOGS_DIR}: ${err.message}`);
  }
}

// ISO-8601 week number, used to pick the rotated log filename. We use
// week-of-year rather than calendar week because it makes filenames
// sortable and unambiguous across year boundaries.
function isoWeekParts(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

function logFilePathForDate(date) {
  const { year, week } = isoWeekParts(date);
  const ww = String(week).padStart(2, "0");
  return path.join(LOGS_DIR, `nrcc-${year}-W${ww}.log`);
}

// Single-line JSON-per-event append. All events go to the same weekly
// file; a real syslog / SIEM integration can tail it. We swallow write
// errors so a wedged disk can never crash the server -- but we do warn
// on the first failure so the operator notices.
let _logWriteWarned = false;
function appendLog(entry) {
  if (!LOGGING_ENABLED) return;
  if (!entry || typeof entry !== "object") return;
  const now = new Date();
  const line = JSON.stringify({
    ts: now.toISOString(),
    type: String(entry.type || "unknown"),
    username: entry.username || null,
    sessionId: entry.sessionId || null,
    pcHost: entry.pcHost || null,
    vmUuid: entry.vmUuid || null,
    remoteIp: entry.remoteIp || null,
    details: entry.details || null
  }) + "\n";
  try {
    fs.appendFileSync(logFilePathForDate(now), line, "utf8");
  } catch (err) {
    if (!_logWriteWarned) {
      console.warn(`[logging] write failed (${err.code || ""}): ${err.message}`);
      _logWriteWarned = true;
    }
  }
}

// Convenience wrapper for handlers that already have `req` in scope.
function appendLogForReq(req, entry) {
  if (!LOGGING_ENABLED) return;
  appendLog({
    ...entry,
    username: entry.username || req.nrccSession?.currentUser || null,
    sessionId: entry.sessionId || req.nrccSid || null,
    pcHost: entry.pcHost || req.nrccSession?.pcHost || null,
    remoteIp: entry.remoteIp || req.ip || null
  });
}

// =====================================================================
// Server-wide runtime config (persisted to SERVER_CONFIG_PATH).
// =====================================================================
//
// Right now the file only carries `logRetentionDays`; new fields can
// land here without a manifest change. The persistence format is a
// plain JSON object so an operator can sed it in an emergency.

const _serverConfigDefaults = Object.freeze({
  logRetentionDays: LOG_RETENTION_DAYS_DEFAULT
});

let _serverConfig = { ..._serverConfigDefaults };

function clampLogRetentionDays(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(LOG_RETENTION_DAYS_MAX, Math.floor(v));
}

function loadServerConfig() {
  try {
    if (!fs.existsSync(SERVER_CONFIG_PATH)) return;
    const raw = fs.readFileSync(SERVER_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if ("logRetentionDays" in parsed) {
        _serverConfig.logRetentionDays = clampLogRetentionDays(parsed.logRetentionDays);
      }
    }
  } catch (err) {
    console.warn(`[server-config] failed to read ${SERVER_CONFIG_PATH}: ${err.message} (using defaults)`);
  }
}

function saveServerConfig() {
  try {
    fs.mkdirSync(path.dirname(SERVER_CONFIG_PATH), { recursive: true });
    // Write to a temp file then rename, so a partial write can never
    // produce a half-parsed config on the next boot.
    const tmp = `${SERVER_CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(_serverConfig, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, SERVER_CONFIG_PATH);
    return true;
  } catch (err) {
    console.warn(`[server-config] failed to write ${SERVER_CONFIG_PATH}: ${err.message}`);
    return false;
  }
}

function getServerConfig() {
  return { ..._serverConfig };
}

// Load the persisted overrides on boot so a pod restart picks up
// whatever the last admin set in the Settings dialog.
loadServerConfig();

// =====================================================================
// Activity log retention sweep
// =====================================================================
//
// Walks LOGS_DIR and deletes any *.log file whose mtime is older than
// the configured retention window. We use mtime rather than parsing
// the ISO-week filename so a manually-renamed file (or a tarball
// extracted into the dir) is still pruned predictably.

function pruneOldLogs(opts) {
  const force = !!(opts && opts.force);
  const days = clampLogRetentionDays(_serverConfig.logRetentionDays);
  if (!days) return { deleted: 0, kept: 0, reason: "retention disabled" };
  if (!LOGGING_ENABLED && !force) return { deleted: 0, kept: 0, reason: "logging disabled" };
  if (!fs.existsSync(LOGS_DIR)) return { deleted: 0, kept: 0, reason: "no logs dir" };
  const cutoffMs = Date.now() - days * 86_400_000;
  let deleted = 0;
  let kept = 0;
  try {
    const entries = fs.readdirSync(LOGS_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      // Only touch files we own: must look like an NRCC log file.
      if (!/^nrcc-.*\.log$/.test(ent.name)) continue;
      const full = path.join(LOGS_DIR, ent.name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoffMs) {
          fs.unlinkSync(full);
          deleted++;
        } else {
          kept++;
        }
      } catch (_e) { /* ignore stat / unlink races */ }
    }
  } catch (err) {
    console.warn(`[logging] prune sweep failed: ${err.message}`);
    return { deleted, kept, reason: `error: ${err.message}` };
  }
  if (deleted > 0) {
    console.log(`[logging] retention sweep: deleted ${deleted}, kept ${kept} (older-than ${days}d)`);
  }
  return { deleted, kept, reason: "ok" };
}

// Run an initial sweep at startup so a long-running deployment that
// just had retention reduced from 90 -> 30 doesn't have to wait for
// the next interval to catch up. Then sweep every 6 hours.
if (LOGGING_ENABLED) {
  setTimeout(() => pruneOldLogs(), 5_000).unref();
  setInterval(() => pruneOldLogs(), 6 * 60 * 60 * 1000).unref();
}

// Pull every IPv4 address on the box for the self-signed cert's SAN
// list, so a browser pointed at the LAN IP doesn't trip a CN mismatch
// warning on top of the "self-signed" warning it already shows.
function localIPv4Addresses() {
  const out = new Set(["127.0.0.1"]);
  try {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const ni of (list || [])) {
        if (ni && ni.family === "IPv4" && !ni.internal && ni.address) out.add(ni.address);
      }
    }
  } catch (_e) { /* best effort */ }
  return Array.from(out);
}

// Load TLS material in this priority order:
//   1) explicit NRCC_TLS_CERT + NRCC_TLS_KEY paths;
//   2) cert.pem / key.pem inside NRCC_TLS_CERT_DIR (default ./certs);
//   3) generate a fresh self-signed cert into NRCC_TLS_CERT_DIR.
// In all cases we log the SHA-256 fingerprint so an operator can pin
// or verify it from the browser's "view certificate" pane.
function loadOrCreateTlsMaterial() {
  let certPath = TLS_CERT_PATH_ENV;
  let keyPath = TLS_KEY_PATH_ENV;
  let source = "env";

  if (!certPath || !keyPath) {
    certPath = path.join(TLS_CERT_DIR, "cert.pem");
    keyPath = path.join(TLS_CERT_DIR, "key.pem");
    source = "cert dir";
  }

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.log(
      `[tls] no certificate found at ${certPath} - generating a self-signed cert. ` +
      `Browsers will show a security warning until you trust this cert or supply your own.`
    );
    const selfsigned = require("selfsigned");
    const hostname = os.hostname();
    const altNames = [
      { type: 2, value: "localhost" },
      ...(hostname && hostname !== "localhost" ? [{ type: 2, value: hostname }] : []),
      ...localIPv4Addresses().map((ip) => ({ type: 7, ip }))
    ];
    const attrs = [{ name: "commonName", value: hostname || "nrcc.local" }];
    const generated = selfsigned.generate(attrs, {
      keySize: 2048,
      days: 825,
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames }
      ]
    });
    fs.mkdirSync(path.dirname(certPath), { recursive: true });
    fs.writeFileSync(certPath, generated.cert, { mode: 0o644 });
    // Best-effort 0o600 on the key. Windows ignores POSIX modes silently.
    fs.writeFileSync(keyPath, generated.private, { mode: 0o600 });
    source = "auto-generated";
  }

  const cert = fs.readFileSync(certPath);
  const key = fs.readFileSync(keyPath);
  const fingerprint = crypto.createHash("sha256").update(cert).digest("hex").match(/.{2}/g).join(":").toUpperCase();
  console.log(`[tls] using cert ${certPath} (${source})`);
  console.log(`[tls] sha256 fingerprint: ${fingerprint}`);
  return { cert, key };
}

// =====================================================================
// In-memory per-VM chat store. Messages are kept in a ring buffer per
// VM UUID; presence is a Set of live WebSocket connections keyed by
// the same UUID. Everything is lost on process restart -- this is by
// design (NRCC is an admin tool, not a chat service). Persistence
// would need a SQLite or JSONL backend; out of scope for this drop.
// =====================================================================
class ChatStore {
  constructor(maxPerVm) {
    this.bufferLimit = maxPerVm;
    this.messages = new Map();   // vmUuid -> Array<{id, vmUuid, username, text, tsMs}>
    this.presence = new Map();   // vmUuid -> Set<ws>
  }
  append(vmUuid, message) {
    let buf = this.messages.get(vmUuid);
    if (!buf) { buf = []; this.messages.set(vmUuid, buf); }
    buf.push(message);
    if (buf.length > this.bufferLimit) buf.splice(0, buf.length - this.bufferLimit);
  }
  history(vmUuid) {
    return (this.messages.get(vmUuid) || []).slice();
  }
  join(vmUuid, ws) {
    let set = this.presence.get(vmUuid);
    if (!set) { set = new Set(); this.presence.set(vmUuid, set); }
    set.add(ws);
  }
  leave(vmUuid, ws) {
    const set = this.presence.get(vmUuid);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.presence.delete(vmUuid);
  }
  socketsIn(vmUuid) {
    return Array.from(this.presence.get(vmUuid) || []);
  }
  // Presence reported to clients is the set of distinct usernames
  // viewing the channel (a single user with two browser tabs counts
  // once), sorted for stable display.
  usersIn(vmUuid) {
    const seen = new Set();
    for (const ws of this.socketsIn(vmUuid)) {
      if (ws.nrccUsername) seen.add(ws.nrccUsername);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }
}

const chatStore = MULTI_USER_MODE ? new ChatStore(CHAT_BUFFER_SIZE) : null;

// Default per-request timeout for Prism HTTP calls. Real Prism Central
// instances under load routinely take 5-15 seconds to return a v4 vmm
// page, so the historical 5 s probe timeout was too aggressive and
// surfaced as `Failed to list VMs. timeout of 5000ms exceeded`. Override
// with NUTANIX_API_TIMEOUT_MS in the environment if your PC is slower
// still.
const PRISM_HTTP_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.NUTANIX_API_TIMEOUT_MS || 30000)
);

// PE credentials live only in this in-memory map, scoped to an opaque
// HttpOnly session cookie. They are never written to disk and never sent
// back to the browser. They evaporate when the NRCC process restarts or
// after SESSION_TTL_MS of inactivity.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const serverSessions = new Map();

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return;
    const key = part.slice(0, eq).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch (_error) {
      out[key] = part.slice(eq + 1).trim();
    }
  });
  return out;
}

function setSessionCookie(res, sid) {
  res.cookie("nrcc_sid", sid, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS
  });
}

function ensureSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  let sid = cookies.nrcc_sid;
  let session = sid ? serverSessions.get(sid) : null;
  const now = Date.now();
  if (!session || now - session.lastSeenAtMs > SESSION_TTL_MS) {
    if (sid) serverSessions.delete(sid);
    sid = crypto.randomUUID();
    session = {
      peCreds: new Map(),
      createdAtMs: now,
      lastSeenAtMs: now
    };
    serverSessions.set(sid, session);
  } else {
    session.lastSeenAtMs = now;
  }
  setSessionCookie(res, sid);
  req.nrccSession = session;
  req.nrccSid = sid;
  next();
}

// Bumped from the default 100kb so screenshot uploads (base64 PNGs of
// 1920x1080+ consoles, ~3-5 MB) fit inside a single JSON POST.
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  "/vendor/novnc",
  express.static(path.join(__dirname, "node_modules", "@novnc", "novnc"))
);
// xterm.js ESM bundles for the SSH terminal. The browser imports them
// from /vendor/xterm/* so we can keep the (large) WebGL renderer out
// of the main bundle and only pay for it when a user actually opens
// an SSH tab.
app.use(
  "/vendor/xterm",
  express.static(path.join(__dirname, "node_modules", "@xterm", "xterm"))
);
app.use(
  "/vendor/xterm-addon-fit",
  express.static(path.join(__dirname, "node_modules", "@xterm", "addon-fit"))
);
app.use(
  "/vendor/xterm-addon-webgl",
  express.static(path.join(__dirname, "node_modules", "@xterm", "addon-webgl"))
);
// guacamole-common-js for the RDP console (beta: rdpConsole). Same
// lazy approach as xterm: served from node_modules so we don't carry
// a duplicate copy in the repo, and only fetched by the browser when
// the user actually opens an RDP tab.
app.use(
  "/vendor/guacamole-common-js",
  express.static(path.join(__dirname, "node_modules", "guacamole-common-js"))
);
app.use("/api", ensureSession);

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Surfaced to the front-end on boot so it knows whether to render the
// chat UI and which retention/buffer limits to advertise. Single-user
// deployments simply see multiUser=false and skip the chat plumbing.
app.get("/api/config", (req, res) => {
  res.json({
    multiUser: MULTI_USER_MODE,
    chatBufferSize: CHAT_BUFFER_SIZE,
    screenshotMaxPerVm: SCREENSHOT_MAX_PER_VM,
    recording: {
      fps: RECORDING_FPS,
      bitrate: RECORDING_BITRATE,
      maxBytes: RECORDING_MAX_BYTES,
      maxPerVm: RECORDING_MAX_PER_VM
    },
    scripts: {
      maxBytes: SCRIPT_MAX_BYTES
    },
    currentUser: req.nrccSession.currentUser || null,
    loggingAvailable: LOGGING_ENABLED,
    featureFlags: FEATURE_FLAGS,
    appVersion: loadAppVersion(),
    updateAvailable: UPDATE_ENABLED,
    // RDP-specific bits the client needs at startup. Default
    // dimensions are advisory — the browser sizes the canvas to its
    // actual screen pane and overrides them in /api/rdp/start.
    rdp: {
      enabled: RDP_ENABLED,
      defaultWidth: RDP_DEFAULT_WIDTH,
      defaultHeight: RDP_DEFAULT_HEIGHT,
      defaultDpi: RDP_DEFAULT_DPI
    },
    // VM folders (beta: vmFolders). The client also gates on the
    // featureFlags entry above; this server-side switch is the
    // operator's kill switch independent of the beta opt-in.
    vmFoldersEnabled: VM_FOLDERS_ENABLED
  });
});

app.get("/api/pe-creds", (req, res) => {
  const peHosts = Array.from(req.nrccSession.peCreds.keys()).sort();
  res.json({ peHosts });
});

app.delete("/api/pe-creds", (req, res) => {
  const cleared = req.nrccSession.peCreds.size;
  req.nrccSession.peCreds.clear();
  res.json({ cleared });
});

app.delete("/api/pe-creds/:peHost", (req, res) => {
  const removed = req.nrccSession.peCreds.delete(req.params.peHost);
  res.json({ removed });
});

// Best-effort cleanup on user logout: wipes the server-side identity
// stash and any cached PE credentials. Doesn't destroy the cookie
// itself (the next login is welcome to reuse the SID and rebuild
// state); just clears the values so the chat WebSocket can't bind to
// a stale username before a re-login completes.
app.post("/api/logout", (req, res) => {
  appendLogForReq(req, { type: "logout" });
  req.nrccSession.peCreds.clear();
  req.nrccSession.currentUser = null;
  req.nrccSession.pcHost = null;
  res.json({ ok: true });
});

// Per-user activity log endpoint. The client gates whether it sends
// at all (via the Settings -> "Record my logins and console activity"
// toggle), and the server only honours requests that explicitly opt
// in via ?clientLogging=1. NRCC_LOGGING off short-circuits both
// sides regardless of the query string.
app.post("/api/log", (req, res) => {
  if (!LOGGING_ENABLED) return res.status(204).end();
  if (req.query.clientLogging !== "1") return res.status(204).end();
  const body = req.body || {};
  const rawType = String(body.type || "").trim();
  const safeType = rawType && CLIENT_LOG_EVENT_TYPES.has(rawType) ? rawType : "client.unknown";
  const details = body.details && typeof body.details === "object" ? body.details : null;
  appendLogForReq(req, {
    type: safeType,
    vmUuid: typeof body.vmUuid === "string" ? body.vmUuid : null,
    details: safeType === "client.unknown" ? { ...details, originalType: rawType } : details
  });
  res.status(204).end();
});

// =====================================================================
// Server-wide runtime config (read + update).
// =====================================================================
//
// All authenticated users may read and edit this -- NRCC has no role
// system and the config only carries operator-tunable knobs that
// affect the whole deployment. The Settings dialog calls these and
// makes it explicit in the UI that "this affects all users".
app.get("/api/server-config", (req, res) => {
  if (!req.nrccSession?.currentUser) {
    return res.status(401).json({ error: "Login required." });
  }
  res.json({
    logRetentionDays: _serverConfig.logRetentionDays,
    logRetentionDaysDefault: LOG_RETENTION_DAYS_DEFAULT,
    logRetentionDaysMax: LOG_RETENTION_DAYS_MAX,
    loggingAvailable: LOGGING_ENABLED,
    logsDir: LOGS_DIR
  });
});

app.put("/api/server-config", (req, res) => {
  if (!req.nrccSession?.currentUser) {
    return res.status(401).json({ error: "Login required." });
  }
  const body = req.body || {};
  if ("logRetentionDays" in body) {
    const next = clampLogRetentionDays(body.logRetentionDays);
    if (next !== _serverConfig.logRetentionDays) {
      const prev = _serverConfig.logRetentionDays;
      _serverConfig.logRetentionDays = next;
      if (!saveServerConfig()) {
        // Roll back the in-memory change so a failed disk write
        // doesn't silently diverge from the persisted state.
        _serverConfig.logRetentionDays = prev;
        return res.status(500).json({ error: "Could not persist server-config change." });
      }
      appendLogForReq(req, {
        type: "server-config.update",
        details: { field: "logRetentionDays", from: prev, to: next }
      });
      // If the new retention is shorter than the previous, sweep
      // immediately so the user sees the effect without waiting for
      // the 6h interval.
      if (next > 0 && (prev === 0 || next < prev)) {
        try { pruneOldLogs({ force: true }); } catch (_e) { /* ignore */ }
      }
    }
  }
  res.json({
    logRetentionDays: _serverConfig.logRetentionDays
  });
});

// =====================================================================
// Logs viewer endpoints (file index + line reader).
// =====================================================================
//
// /api/logs/files lists every weekly file under LOGS_DIR (newest
// first) with a size summary. /api/logs reads one file with optional
// filters and pagination -- the response always carries the total
// count of MATCHING entries so the UI can render proper paging.
//
// All entries are kept in memory only for the duration of the
// request, and we cap the per-page limit to keep big reads bounded.

const LOGS_VIEW_PAGE_MAX = 1000;

function isSafeLogFilename(name) {
  // Only allow "nrcc-...log" with no path separators -- prevents the
  // viewer from being used to peek at arbitrary files on disk.
  if (typeof name !== "string") return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  return /^nrcc-[A-Za-z0-9_-]+\.log$/.test(name);
}

app.get("/api/logs/files", (req, res) => {
  if (!req.nrccSession?.currentUser) {
    return res.status(401).json({ error: "Login required." });
  }
  if (!LOGGING_ENABLED) {
    return res.json({ enabled: false, retentionDays: _serverConfig.logRetentionDays, files: [] });
  }
  let files = [];
  try {
    if (fs.existsSync(LOGS_DIR)) {
      const entries = fs.readdirSync(LOGS_DIR, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        if (!isSafeLogFilename(ent.name)) continue;
        const full = path.join(LOGS_DIR, ent.name);
        try {
          const st = fs.statSync(full);
          files.push({
            name: ent.name,
            sizeBytes: st.size,
            mtime: st.mtime.toISOString()
          });
        } catch (_e) { /* skip files that vanish mid-walk */ }
      }
    }
  } catch (err) {
    return res.status(500).json({ error: `failed to list logs: ${err.message}` });
  }
  // Newest first so the dropdown defaults to the active week.
  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  res.json({
    enabled: true,
    retentionDays: _serverConfig.logRetentionDays,
    files
  });
});

app.get("/api/logs", (req, res) => {
  if (!req.nrccSession?.currentUser) {
    return res.status(401).json({ error: "Login required." });
  }
  if (!LOGGING_ENABLED) {
    return res.status(503).json({ error: "Logging is disabled (NRCC_LOGGING=false)." });
  }
  const filename = String(req.query.file || "").trim();
  if (!isSafeLogFilename(filename)) {
    return res.status(400).json({ error: "Invalid file." });
  }
  const fullPath = path.join(LOGS_DIR, filename);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "File not found." });
  }
  // Filters
  const wantType = String(req.query.type || "").trim();
  const wantUser = String(req.query.user || "").trim().toLowerCase();
  const wantVm = String(req.query.vm || "").trim();
  const search = String(req.query.q || "").trim().toLowerCase();
  // Pagination
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.max(1, Math.min(LOGS_VIEW_PAGE_MAX, Number(req.query.limit) || 200));
  // Newest first by default; let the UI flip via ?order=asc.
  const newestFirst = String(req.query.order || "desc").toLowerCase() !== "asc";

  let raw;
  try {
    raw = fs.readFileSync(fullPath, "utf8");
  } catch (err) {
    return res.status(500).json({ error: `failed to read file: ${err.message}` });
  }
  const lines = raw.split("\n");
  // Decode + filter in a single pass. Bad lines are still surfaced
  // (as `_raw`) so a partially-corrupt file doesn't disappear from
  // view.
  const allEntries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); }
    catch { entry = { _raw: line }; }
    if (typeof entry !== "object" || entry === null) {
      entry = { _raw: line };
    }
    // Apply filters
    if (wantType && entry.type !== wantType) continue;
    if (wantUser) {
      const u = String(entry.username || "").toLowerCase();
      if (!u.includes(wantUser)) continue;
    }
    if (wantVm && entry.vmUuid !== wantVm) continue;
    if (search) {
      // Cheap substring match across the raw JSON string -- catches
      // hits in `details` without per-key plumbing.
      if (!line.toLowerCase().includes(search)) continue;
    }
    allEntries.push(entry);
  }
  if (newestFirst) allEntries.reverse();
  const total = allEntries.length;
  const paged = allEntries.slice(offset, offset + limit);
  // Distinct event types in the filtered set, so the UI can populate
  // a "type" filter dropdown without scanning twice.
  const typesSeen = new Set();
  for (const e of allEntries) if (e && e.type) typesSeen.add(e.type);
  res.json({
    file: filename,
    total,
    offset,
    limit,
    order: newestFirst ? "desc" : "asc",
    types: Array.from(typesSeen).sort(),
    entries: paged
  });
});

// =====================================================================
// In-app self-update from GitHub.
//
// The Settings dialog shows the current build number (APP_VERSION) and
// a blue "Update" button. Clicking it hits /api/update/check which
// fetches the repo's `build.info` over raw.githubusercontent and
// compares it to APP_VERSION. If a newer build is available the
// client confirms and POSTs /api/update/install, which 202-replies
// immediately and then runs the upgrade in the background:
//   - Path A (in-place git): git fetch + git reset --hard
//   - Path B (clone-and-swap): git clone --depth 1 to a tmp dir, then
//     copy each child into the install dir, skipping UPDATE_PRESERVE
//     entries (logs/, recordings/, screenshots/, etc) so user data
//     isn't clobbered.
// In both paths we then run `npm install --omit=dev --no-audit
// --no-fund`, log an "update.install" event, and process.exit(0) to
// hand off to whatever supervisor (k8s Deployment, systemd, PM2, ...)
// owns the process and will restart it with the new code.
// =====================================================================

let _updateInFlight = false;
// Short-lived cache of the most recent /api/update/check result so
// the auto-poll the client runs (every UPDATE_CHECK_TTL_MS or so)
// and any concurrent users sharing the install don't hammer
// raw.githubusercontent.com. The cache is invalidated automatically
// when its age exceeds the TTL.
const UPDATE_CHECK_TTL_MS = Math.max(60_000, Number(process.env.NRCC_UPDATE_CHECK_TTL_MS || 5 * 60 * 1000));
let _updateCheckCache = null; // { ts: number, info: <fetchRemoteBuildInfo result> }

// Parse "https://github.com/<owner>/<repo>(.git)?" into { owner, repo }.
// Anything else returns null and the caller bails with a 500.
function parseGithubRepo(repoUrl) {
  if (typeof repoUrl !== "string") return null;
  const m = repoUrl.trim().replace(/\.git$/i, "").match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

// Same shape as VERSION_RE in scripts/bump-build.js. The trailing
// -YYYYMMDD-NN is optional so plain "1.2.3" tags from a release branch
// still validate.
const UPDATE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(\d{8})-(\d{1,3}))?$/;

function parseAppVersion(v) {
  const s = String(v || "").trim();
  const m = s.match(UPDATE_VERSION_RE);
  if (!m) return null;
  return {
    raw: s,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    date:  m[4] ? Number(m[4]) : 0,
    build: m[5] ? Number(m[5]) : 0
  };
}

// Returns >0 when `b` is newer than `a`, <0 when `a` is newer, 0 when equal.
function compareAppVersion(a, b) {
  const pa = parseAppVersion(a);
  const pb = parseAppVersion(b);
  if (!pa || !pb) {
    // Fall back to plain string compare so an unparseable remote at
    // least doesn't claim "you are up to date" when it's not.
    if (String(a) === String(b)) return 0;
    return String(a) < String(b) ? 1 : -1;
  }
  if (pa.major !== pb.major) return pb.major - pa.major;
  if (pa.minor !== pb.minor) return pb.minor - pa.minor;
  if (pa.patch !== pb.patch) return pb.patch - pa.patch;
  if (pa.date  !== pb.date)  return pb.date  - pa.date;
  if (pa.build !== pb.build) return pb.build - pa.build;
  return 0;
}

function rawBuildInfoUrl() {
  const parsed = parseGithubRepo(UPDATE_REPO);
  if (!parsed) return null;
  return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodeURIComponent(UPDATE_BRANCH)}/build.info`;
}

function compareUrl(remoteVersion) {
  const parsed = parseGithubRepo(UPDATE_REPO);
  if (!parsed) return null;
  return `https://github.com/${parsed.owner}/${parsed.repo}/compare/${encodeURIComponent(APP_VERSION)}...${encodeURIComponent(remoteVersion)}`;
}

// Single source of truth for "what build does the GitHub repo say is
// current?" Returns { current, latest, updateAvailable, repo, branch,
// url } or throws on failure. Pass `force: true` to bypass the
// in-memory cache (used by the install handler to re-validate
// immediately before the file swap).
async function fetchRemoteBuildInfo(opts) {
  const force = !!(opts && opts.force);
  if (!force && _updateCheckCache && (Date.now() - _updateCheckCache.ts) < UPDATE_CHECK_TTL_MS) {
    // Re-stamp `current` against build.info on disk (not the
    // process-startup APP_VERSION) so out-of-band file swaps
    // (kubectl cp, manual rsync, a self-update install that
    // restarted node, etc.) are reflected immediately. Everything
    // else is a snapshot of the most recent remote read.
    const liveCurrent = loadAppVersion();
    return Object.assign({}, _updateCheckCache.info, {
      current: liveCurrent,
      updateAvailable: compareAppVersion(liveCurrent, _updateCheckCache.info.latest) > 0,
      cached: true,
      cacheAgeMs: Date.now() - _updateCheckCache.ts
    });
  }
  const url = rawBuildInfoUrl();
  if (!url) {
    const err = new Error("invalid NRCC_UPDATE_REPO; expected https://github.com/<owner>/<repo>");
    err.statusCode = 500;
    throw err;
  }
  let res;
  try {
    res = await axios.get(url, {
      timeout: 10000,
      // axios tries to JSON-parse a one-line "1.2.3" body; the
      // identity transform forces it to stay a plain string.
      transformResponse: [(r) => r],
      headers: { "Accept": "text/plain", "User-Agent": `nrcc/${APP_VERSION}` },
      validateStatus: () => true
    });
  } catch (err) {
    const e = new Error(`failed to reach GitHub: ${err.message}`);
    e.statusCode = 502;
    e.cause = err;
    throw e;
  }
  if (res.status !== 200) {
    const e = new Error(`GitHub returned ${res.status} fetching build.info`);
    e.statusCode = 502;
    e.details = { status: res.status, body: typeof res.data === "string" ? res.data.slice(0, 200) : null };
    throw e;
  }
  const latest = String(res.data || "").split(/\r?\n/)[0].trim();
  if (!UPDATE_VERSION_RE.test(latest)) {
    const e = new Error(`remote build.info value is not a recognised version string: "${latest.slice(0, 80)}"`);
    e.statusCode = 502;
    throw e;
  }
  // Same rationale as the cached path above: read build.info live so
  // any post-startup file swap is reflected without a node restart.
  const liveCurrent = loadAppVersion();
  const cmp = compareAppVersion(liveCurrent, latest);
  const info = {
    current: liveCurrent,
    latest,
    updateAvailable: cmp > 0,
    repo: UPDATE_REPO,
    branch: UPDATE_BRANCH,
    url: compareUrl(latest),
    cached: false,
    cacheAgeMs: 0
  };
  _updateCheckCache = { ts: Date.now(), info: { ...info, cached: false, cacheAgeMs: 0 } };
  return info;
}

app.post("/api/update/check", async (req, res) => {
  if (!UPDATE_ENABLED) {
    return res.status(503).json({ error: "Self-update is disabled on this server (NRCC_UPDATE_ENABLED=false)." });
  }
  if (!req.nrccSession?.currentUser) {
    return res.status(401).json({ error: "Login required." });
  }
  // ?force=1 bypasses the cache (used by the explicit Update click
  // when the user wants a fresh read; the auto-poll uses the cache).
  const force = String(req.query.force || "") === "1";
  try {
    const info = await fetchRemoteBuildInfo({ force });
    res.json(info);
  } catch (err) {
    const status = err.statusCode || 502;
    res.status(status).json({ error: err.message, details: err.details || null });
  }
});

// Spawn a child process inheriting stdio, return a Promise that
// resolves with {code, signal} on exit. Used by the upgrade pipeline
// so each step is isolated and the operator sees the live output in
// the server's stdout/stderr.
function runChild(file, args, opts) {
  return new Promise((resolve, reject) => {
    const child = child_process.spawn(file, args, Object.assign({ stdio: "inherit" }, opts || {}));
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

function gitAvailable() {
  try {
    child_process.execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch (_e) { return false; }
}

// Copy <srcDir>/* into <destDir>, skipping any top-level entry whose
// name is in UPDATE_PRESERVE. Uses fs.cpSync (Node 16.7+) for the
// recursive copy, with `force: true` so existing files are
// overwritten. We only iterate the top-level entries because
// UPDATE_PRESERVE only protects top-level names by design (e.g. we
// always want to overwrite public/app.js even though `scripts/` at
// the top level is preserved).
function swapInstallTree(srcDir, destDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    if (UPDATE_PRESERVE.has(ent.name)) continue;
    const from = path.join(srcDir, ent.name);
    const to   = path.join(destDir, ent.name);
    fs.cpSync(from, to, { recursive: true, force: true });
  }
}

async function runUpdate(latest) {
  const installDir = __dirname;
  const inPlaceGit = fs.existsSync(path.join(installDir, ".git"));
  const mode = inPlaceGit ? "git-pull" : "clone-swap";
  console.log(`[update] starting ${mode} upgrade ${APP_VERSION} -> ${latest}`);

  if (!gitAvailable()) {
    console.warn("[update] git not on PATH; aborting upgrade. Install git on the host and retry.");
    appendLog({ type: "update.failed", details: { from: APP_VERSION, to: latest, mode, reason: "git-missing" } });
    _updateInFlight = false;
    return;
  }

  try {
    if (inPlaceGit) {
      let r = await runChild("git", ["-C", installDir, "fetch", "--depth", "1", "origin", UPDATE_BRANCH]);
      if (r.code !== 0) throw new Error(`git fetch exited ${r.code}`);
      r = await runChild("git", ["-C", installDir, "reset", "--hard", `origin/${UPDATE_BRANCH}`]);
      if (r.code !== 0) throw new Error(`git reset exited ${r.code}`);
    } else {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nrcc-update-"));
      try {
        const r = await runChild("git", ["clone", "--depth", "1", "--branch", UPDATE_BRANCH, UPDATE_REPO, tmpDir]);
        if (r.code !== 0) throw new Error(`git clone exited ${r.code}`);
        swapInstallTree(tmpDir, installDir);
        // Mirror build.info from the cloned tree so the local stamp
        // matches what's on disk (the install would otherwise still
        // report APP_VERSION until restart anyway, but writing it
        // explicitly catches the edge case where build.info itself
        // was in UPDATE_PRESERVE for a previous release).
        const remoteBuildInfo = path.join(tmpDir, "build.info");
        if (fs.existsSync(remoteBuildInfo)) {
          fs.copyFileSync(remoteBuildInfo, path.join(installDir, "build.info"));
        }
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
      }
    }

    // Always re-resolve dependencies after the file swap. We prefer
    // `npm ci` when a package-lock.json exists - it deletes and
    // rebuilds node_modules from the lockfile exactly, which is both
    // faster than `npm install` for clean trees and guarantees the
    // newly-checked-out lockfile is honoured. If there's no lockfile
    // we fall back to plain `npm install`.
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const lockExists = fs.existsSync(path.join(installDir, "package-lock.json"));
    const npmCmd = lockExists ? "ci" : "install";
    console.log(`[update] running 'npm ${npmCmd} --omit=dev' in ${installDir}`);
    const npmRes = await runChild(npm, [npmCmd, "--omit=dev", "--no-audit", "--no-fund"], { cwd: installDir });
    if (npmRes.code !== 0) {
      console.warn(`[update] npm ${npmCmd} exited ${npmRes.code}; continuing with restart anyway (existing node_modules may still be usable)`);
    } else {
      console.log(`[update] npm ${npmCmd} completed successfully`);
    }

    appendLog({ type: "update.install", details: {
      from: APP_VERSION, to: latest, mode,
      npm: npmCmd,
      npmExit: npmRes.code
    } });
    console.log(`[update] upgrade applied; exiting so supervisor can restart with new code`);
    setTimeout(() => process.exit(0), 250);
  } catch (err) {
    console.error(`[update] upgrade failed: ${err.message}`);
    appendLog({ type: "update.failed", details: { from: APP_VERSION, to: latest, mode, reason: err.message } });
    _updateInFlight = false;
  }
}

app.post("/api/update/install", async (req, res) => {
  if (!UPDATE_ENABLED) {
    return res.status(503).json({ error: "Self-update is disabled on this server (NRCC_UPDATE_ENABLED=false)." });
  }
  if (!req.nrccSession?.currentUser) {
    return res.status(401).json({ error: "Login required." });
  }
  if (_updateInFlight) {
    return res.status(409).json({ error: "An update is already in progress." });
  }

  let info;
  try {
    info = await fetchRemoteBuildInfo({ force: true });
  } catch (err) {
    const status = err.statusCode || 502;
    return res.status(status).json({ error: err.message, details: err.details || null });
  }

  if (!info.updateAvailable) {
    return res.status(409).json({ error: "Already on the latest build.", current: info.current, latest: info.latest });
  }

  _updateInFlight = true;
  appendLogForReq(req, { type: "update.requested", details: { from: info.current, to: info.latest } });
  res.status(202).json({ ok: true, message: "Update started; server will restart.", from: info.current, to: info.latest });

  // Defer the actual work so Express can flush the 202 before we
  // start spawning git and (eventually) call process.exit.
  setImmediate(() => { runUpdate(info.latest); });
});

// =====================================================================
// VM port-scan probe (POST /api/probe/ports)
// =====================================================================
//
// Server-side TCP-connect probe. The browser cannot raw-dial sockets
// itself, so the client batches its known VM IPs through this
// endpoint after the VM list arrives. Results are cached per-VM so
// repeated re-renders / re-prompts do not multiply the dial volume.
//
// The same cache is consulted by /api/ssh/start as the SSRF guard:
// an SSH session can only target an IP that the probe just observed
// for that VM. This means an attacker who fakes /api/ssh/start
// requests still cannot pivot to arbitrary internal hosts because
// the probe is the only way to seed the allow-list, and the probe
// itself rejects anything outside the local / RFC1918 ranges.
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

function isProbeAllowedIp(ip) {
  if (typeof ip !== "string" || !IPV4_REGEX.test(ip)) return false;
  const parts = ip.split(".").map((s) => Number(s));
  const [a, b] = parts;
  // RFC1918 private ranges
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Carrier-grade NAT (often used in lab/test setups)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Link-local
  if (a === 169 && b === 254) return true;
  // Loopback - useful for local smoke tests against sshd on the host
  if (a === 127) return true;
  return false;
}

// Cache shape: Map<vmUuid, { ts, ips: Map<ip, Map<port, status>> }>
// Each port's status is one of: "open" | "refused" | "timeout" | "error".
const probeCache = new Map();

function probeCacheGet(uuid) {
  const entry = probeCache.get(uuid);
  if (!entry) return null;
  if ((Date.now() - entry.ts) > PROBE_CACHE_TTL_MS) {
    probeCache.delete(uuid);
    return null;
  }
  return entry;
}

function summariseProbeEntry(entry) {
  if (!entry) return null;
  const ips = {};
  let ssh = false, rdp = false;
  let preferredSshIp = null, preferredRdpIp = null;
  for (const [ip, ports] of entry.ips.entries()) {
    const portObj = {};
    for (const [port, status] of ports.entries()) {
      portObj[String(port)] = status;
      if (status === "open") {
        if (port === 22) {
          ssh = true;
          if (!preferredSshIp) preferredSshIp = ip;
        } else if (port === 3389) {
          rdp = true;
          if (!preferredRdpIp) preferredRdpIp = ip;
        }
      }
    }
    ips[ip] = portObj;
  }
  return {
    scannedAt: entry.ts,
    ips,
    ssh,
    rdp,
    preferredIp: { ssh: preferredSshIp, rdp: preferredRdpIp }
  };
}

// TCP connect probe with bounded timeout. Resolves to a status string;
// never rejects (callers Promise.all without try/catch).
function probeOneTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_e) { /* already destroyed */ }
      resolve(status);
    };
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("open"));
    socket.once("timeout", () => finish("timeout"));
    socket.once("error", (err) => {
      // ECONNREFUSED is informative ("nothing listening, but the host
      // is reachable"). Other errors collapse to "error".
      if (err && err.code === "ECONNREFUSED") finish("refused");
      else finish("error");
    });
    try {
      socket.connect({ host, port });
    } catch (_e) {
      finish("error");
    }
  });
}

// Lightweight semaphore for the global concurrency cap. Returns a
// release callback that the caller MUST invoke (we use try/finally).
function makeSemaphore(max) {
  let active = 0;
  const waiters = [];
  function acquire() {
    if (active < max) {
      active += 1;
      return Promise.resolve(release);
    }
    return new Promise((resolve) => waiters.push(resolve));
  }
  function release() {
    active -= 1;
    const next = waiters.shift();
    if (next) {
      active += 1;
      next(release);
    }
  }
  return { acquire };
}

const probeSemaphore = makeSemaphore(PROBE_CONCURRENCY);

async function probeVm(uuid, ipAddresses) {
  const cached = probeCacheGet(uuid);
  if (cached) return cached;
  const ipsMap = new Map();
  const tasks = [];
  // Trim, dedupe, validate, and cap per-VM IP fan-out before any TCP work.
  const seen = new Set();
  const ipsToProbe = [];
  for (const raw of ipAddresses) {
    const ip = String(raw || "").trim();
    if (!isProbeAllowedIp(ip)) continue;
    if (seen.has(ip)) continue;
    seen.add(ip);
    ipsToProbe.push(ip);
    if (ipsToProbe.length >= PROBE_MAX_IPS_PER_VM) break;
  }
  for (const ip of ipsToProbe) {
    const portsMap = new Map();
    ipsMap.set(ip, portsMap);
    for (const port of PROBE_PORTS) {
      tasks.push((async () => {
        const release = await probeSemaphore.acquire();
        try {
          const status = await probeOneTcp(ip, port, PROBE_TIMEOUT_MS);
          portsMap.set(port, status);
        } finally {
          release();
        }
      })());
    }
  }
  await Promise.all(tasks);
  const entry = { ts: Date.now(), ips: ipsMap };
  probeCache.set(uuid, entry);
  return entry;
}

// Periodic cache sweep so a long-lived process doesn't hold onto
// entries for VMs the user no longer touches.
setInterval(() => {
  const cutoff = Date.now() - PROBE_CACHE_TTL_MS;
  for (const [uuid, entry] of probeCache.entries()) {
    if (entry.ts < cutoff) probeCache.delete(uuid);
  }
}, Math.max(60_000, Math.floor(PROBE_CACHE_TTL_MS / 2))).unref();

app.post("/api/probe/ports", async (req, res) => {
  if (!PROBE_ENABLED) {
    return res.status(503).json({ error: "Port-scan probe is disabled (NRCC_PROBE_ENABLED=false)." });
  }
  if (!req.nrccSession?.currentUser) {
    return res.status(401).json({ error: "Login required." });
  }
  const body = req.body || {};
  const vms = Array.isArray(body.vms) ? body.vms : null;
  if (!vms) {
    return res.status(400).json({ error: "Body must include `vms: [{ uuid, ipAddresses }]`." });
  }
  // Cap the per-request VM count so a malicious client cannot pin the
  // event loop with a single 50k-VM payload. The legitimate client
  // batches in groups of 50.
  if (vms.length > 200) {
    return res.status(413).json({ error: "Too many VMs in one request (max 200)." });
  }

  const ports = PROBE_PORTS.slice();
  const results = {};
  let totalScanned = 0;
  await Promise.all(vms.map(async (vm) => {
    if (!vm || typeof vm !== "object") return;
    const uuid = String(vm.uuid || "").toLowerCase();
    if (!VM_UUID_REGEX.test(uuid)) return;
    const ipAddresses = Array.isArray(vm.ipAddresses) ? vm.ipAddresses : [];
    if (!ipAddresses.length) {
      results[uuid] = { scannedAt: Date.now(), ips: {}, ssh: false, rdp: false, preferredIp: { ssh: null, rdp: null } };
      return;
    }
    const cachedBefore = probeCache.has(uuid);
    const entry = await probeVm(uuid, ipAddresses);
    results[uuid] = summariseProbeEntry(entry);
    if (!cachedBefore) totalScanned += 1;
  }));

  if (totalScanned > 0) {
    appendLogForReq(req, {
      type: "probe.scan",
      details: { vmCount: vms.length, scannedNow: totalScanned, ports }
    });
  }
  res.json({ ports, results });
});

// =====================================================================
// SSH browser console (POST /api/ssh/start, WS /ws-ssh/<sessionId>)
// =====================================================================
//
// The HTTP endpoint validates credentials + host, allocates a session
// id, and stores the connection metadata in `sshSessions`. The WS
// upgrade at /ws-ssh/<id> is what actually opens the ssh2.Client and
// pipes its shell stream to the browser; the session is consumed
// (deleted from the map) on the WS upgrade so a session id can only
// be used once. This means we never persist the SSH password beyond
// the lifetime of a single WebSocket connection.

let _ssh2Module = null;
function getSsh2() {
  if (_ssh2Module) return _ssh2Module;
  try {
    _ssh2Module = require("ssh2");
    return _ssh2Module;
  } catch (err) {
    console.warn(`[ssh] ssh2 module not installed: ${err.message}`);
    return null;
  }
}

// sessionId -> { vmUuid, host, port, username, password|privateKey,
//                passphrase, owner, createdAt, expiresAt }
const sshSessions = new Map();

function probeSawOpenPort(uuid, host, port) {
  const entry = probeCacheGet(uuid);
  if (!entry) return false;
  const ports = entry.ips.get(host);
  if (!ports) return false;
  return ports.get(port) === "open";
}

// Soft SSRF guard: returns true if `host` is one of the IPs we've
// probed for this VM, regardless of port status. The IPs in the
// probe cache came from the VM's Prism-reported `ipAddresses`, so a
// hit here means "this is one of the VM's own addresses" -- which
// is the security property we actually want to enforce. This lets
// the user attempt SSH against an IP whose port 22 looked closed
// (firewall blocking SYN, source-IP ACLs, etc.) without giving up
// the protection that they cannot pivot to arbitrary internal hosts.
function probeKnowsIpForVm(uuid, host) {
  const entry = probeCacheGet(uuid);
  if (!entry) return false;
  return entry.ips.has(host);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of sshSessions.entries()) {
    if (sess.expiresAt < now) sshSessions.delete(id);
  }
}, 60_000).unref();

app.post("/api/ssh/start", (req, res) => {
  if (!SSH_ENABLED) {
    return res.status(503).json({ error: "SSH consoles are disabled (NRCC_SSH_ENABLED=false)." });
  }
  if (!req.nrccSession?.currentUser) {
    return res.status(401).json({ error: "Login required." });
  }
  if (!getSsh2()) {
    return res.status(503).json({ error: "Server is missing the ssh2 dependency. Run `npm install` and restart." });
  }
  if (sshSessions.size >= SSH_MAX_SESSIONS) {
    return res.status(429).json({ error: `Maximum SSH session count reached (${SSH_MAX_SESSIONS}). Close some tabs and retry.` });
  }
  const body = req.body || {};
  const vmUuid = String(body.vmUuid || "").toLowerCase();
  const host = String(body.host || "").trim();
  const port = Number(body.port || 22);
  const username = String(body.username || "").trim();
  const password = typeof body.password === "string" ? body.password : "";
  const privateKey = typeof body.privateKey === "string" ? body.privateKey.trim() : "";
  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";

  if (!VM_UUID_REGEX.test(vmUuid)) return res.status(400).json({ error: "Invalid vmUuid." });
  if (!IPV4_REGEX.test(host) || !isProbeAllowedIp(host)) return res.status(400).json({ error: "Invalid or non-private host." });
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: "Invalid port." });
  if (!username) return res.status(400).json({ error: "Username is required." });
  if (!password && !privateKey) return res.status(400).json({ error: "Either password or privateKey is required." });
  // SSRF guard: the host MUST be one of the IPs we've probed for this
  // VM. Whether the probe saw the port open is now an advisory hint
  // only -- the user is allowed to "try anyway" against a closed-
  // looking address since firewalls can block the probe SYN while
  // still permitting the real SSH source-IP.
  if (!probeKnowsIpForVm(vmUuid, host)) {
    return res.status(400).json({ error: `Host ${host} is not a known address for this VM. Run a port scan first.` });
  }

  const sessionId = crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  sshSessions.set(sessionId, {
    vmUuid,
    host,
    port,
    username,
    password,
    privateKey,
    passphrase,
    owner: req.nrccSession.currentUser,
    sessionCookie: req.nrccSid || null,
    createdAt: now,
    expiresAt: now + SSH_IDLE_TIMEOUT_MS
  });
  res.json({ sessionId, websocketUrl: `/ws-ssh/${sessionId}` });
});

// =====================================================================
// RDP browser console (POST /api/rdp/start, WS /ws-rdp/<sessionId>)
// =====================================================================
//
// Mirrors the SSH endpoints: HTTP call validates credentials + host
// and parks them in `rdpSessions`; the WS upgrade consumes the entry
// (single-use), opens TCP to guacd, performs the Guacamole handshake
// using the stored creds, and pipes raw protocol bytes both
// directions.
const rdpSessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of rdpSessions.entries()) {
    if (sess.expiresAt < now) rdpSessions.delete(id);
  }
}, 60_000).unref();

app.post("/api/rdp/start", (req, res) => {
  // Lightweight request log so we can confirm a hang is in the
  // browser/network and not in the server. Logged BEFORE any
  // validation so even rejected requests show up.
  console.log(
    `[rdp] /api/rdp/start from ${req.ip || req.socket?.remoteAddress || "?"} ` +
    `vm=${(req.body && req.body.vmUuid) || "?"} host=${(req.body && req.body.host) || "?"}`
  );
  if (!RDP_ENABLED) {
    return res.status(503).json({ error: "RDP consoles are disabled (NRCC_RDP_ENABLED=false)." });
  }
  if (!req.nrccSession?.currentUser) {
    return res.status(401).json({ error: "Login required." });
  }
  if (rdpSessions.size >= RDP_MAX_SESSIONS) {
    return res.status(429).json({ error: `Maximum RDP session count reached (${RDP_MAX_SESSIONS}). Close some tabs and retry.` });
  }
  const body = req.body || {};
  const vmUuid = String(body.vmUuid || "").toLowerCase();
  const host = String(body.host || "").trim();
  const port = Number(body.port || 3389);
  const username = String(body.username || "").trim();
  const password = typeof body.password === "string" ? body.password : "";
  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  // Display dimensions are advisory bounds; the browser reports its
  // actual canvas size so guacd produces correctly-sized framebuffers
  // from the very first frame.
  const width = Math.max(640, Math.min(4096, Number(body.width || RDP_DEFAULT_WIDTH)));
  const height = Math.max(480, Math.min(4096, Number(body.height || RDP_DEFAULT_HEIGHT)));
  const dpi = Math.max(72, Math.min(192, Number(body.dpi || RDP_DEFAULT_DPI)));
  const security = (typeof body.security === "string" && body.security.trim())
    ? body.security.trim().toLowerCase()
    : RDP_SECURITY;
  const ignoreCert = (typeof body.ignoreCert === "boolean") ? body.ignoreCert : RDP_IGNORE_CERT;

  if (!VM_UUID_REGEX.test(vmUuid)) return res.status(400).json({ error: "Invalid vmUuid." });
  if (!IPV4_REGEX.test(host) || !isProbeAllowedIp(host)) return res.status(400).json({ error: "Invalid or non-private host." });
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: "Invalid port." });
  if (!username) return res.status(400).json({ error: "Username is required." });
  // Password is intentionally optional. mstsc / xfreerdp will both
  // happily connect with an empty password; the RDP server then shows
  // its own credential prompt on the framebuffer. We let guacd pass an
  // empty password through so the same flow works in the browser.
  if (!probeKnowsIpForVm(vmUuid, host)) {
    return res.status(400).json({ error: `Host ${host} is not a known address for this VM. Run a port scan first.` });
  }

  const sessionId = crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  rdpSessions.set(sessionId, {
    vmUuid,
    host,
    port,
    username,
    password,
    domain,
    width,
    height,
    dpi,
    security,
    ignoreCert,
    owner: req.nrccSession.currentUser,
    sessionCookie: req.nrccSid || null,
    createdAt: now,
    expiresAt: now + RDP_IDLE_TIMEOUT_MS
  });
  res.json({ sessionId, websocketUrl: `/ws-rdp/${sessionId}` });
});

// =====================================================================
// Shared asset-library helpers (used by screenshots, recordings, and
// scripts). These centralise the path-safety pattern that the original
// per-VM screenshot routes invented:
//   - validate the UUID and folder path against strict regexes,
//   - resolve the absolute path,
//   - re-verify the resolved path is still inside the configured base
//     directory (defence in depth against any edge-case unicode /
//     normalisation trick the regex might have missed).
// Each asset can carry a single text caption stored in a sibling
// `<file>.json` sidecar; `readMeta` / `writeMeta` / `removeMeta`
// hide that detail from the route handlers.
// =====================================================================
const SCREENSHOT_FILENAME_REGEX = /^[\w.-]+\.png$/;
const RECORDING_FILENAME_REGEX = /^[\w.-]+\.webm$/;
const SCRIPT_FILENAME_REGEX = /^[\w.-]+\.txt$/;
// Each path segment in a virtual subfolder name. Letters, digits,
// underscores, dots, hyphens, spaces. Length-capped per segment to keep
// things sane on Windows (which has stricter total-path limits than
// POSIX).
const FOLDER_SEGMENT_REGEX = /^[\w.\- ]{1,64}$/;
const MAX_FOLDER_DEPTH = 8;
const MAX_CAPTION_BYTES = 2048;

function safeRelFolder(folder) {
  if (folder === undefined || folder === null) return "";
  const raw = String(folder).trim();
  if (!raw || raw === "/" || raw === ".") return "";
  // Reject backslashes outright; a Windows-style path has no business
  // arriving from the browser, and accepting them would let a client
  // smuggle `..\` past the POSIX-only normalisation below.
  if (raw.includes("\\")) return null;
  if (raw.startsWith("/")) return null;
  const segments = raw.split("/").filter(Boolean);
  if (segments.length > MAX_FOLDER_DEPTH) return null;
  for (const seg of segments) {
    if (seg === "." || seg === "..") return null;
    if (!FOLDER_SEGMENT_REGEX.test(seg)) return null;
  }
  return segments.join("/");
}

function safeVmUuid(vmUuid) {
  const lower = String(vmUuid || "").toLowerCase();
  return VM_UUID_REGEX.test(lower) ? lower : null;
}

// Resolve `<baseDir>[/<vmUuid>][/<rel folder>]` to an absolute path,
// re-checking that the resolved path is still under baseDir. Pass
// `vmUuid = null` for non-VM-scoped libraries (i.e. scripts).
function safeAssetDir(baseDir, vmUuid, folder) {
  let root = baseDir;
  if (vmUuid !== null) {
    const lower = safeVmUuid(vmUuid);
    if (!lower) return null;
    root = path.join(baseDir, lower);
  }
  const rel = safeRelFolder(folder);
  if (rel === null) return null;
  const abs = rel ? path.join(root, ...rel.split("/")) : root;
  // Defence in depth: confirm the resolved path is still under baseDir.
  const baseWithSep = baseDir + path.sep;
  if (!abs.startsWith(baseWithSep) && abs !== baseDir) return null;
  return abs;
}

function metaPathFor(absFile) {
  return `${absFile}.json`;
}

function readMeta(absFile) {
  try {
    const raw = fs.readFileSync(metaPathFor(absFile), "utf8");
    const data = JSON.parse(raw);
    return (data && typeof data === "object") ? data : {};
  } catch (_e) {
    return {};
  }
}

function writeMeta(absFile, patch) {
  const current = readMeta(absFile);
  const merged = { ...current, ...patch };
  try {
    fs.writeFileSync(metaPathFor(absFile), JSON.stringify(merged), { mode: 0o644 });
    return merged;
  } catch (err) {
    throw new Error(`Could not write metadata: ${err.message}`);
  }
}

function removeMeta(absFile) {
  try { fs.unlinkSync(metaPathFor(absFile)); }
  catch (_e) { /* sidecar may not exist; that's fine */ }
}

// Recursive listing for a single asset folder: returns the immediate
// child folders and the immediate child files matching `fileRegex`.
// Each file entry includes its caption sidecar value if present.
function listAssetEntries(absDir, fileRegex) {
  let names;
  try { names = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch (err) {
    if (err.code === "ENOENT") return { folders: [], items: [] };
    throw err;
  }
  const folders = [];
  const items = [];
  for (const dirent of names) {
    const name = dirent.name;
    if (dirent.isDirectory()) {
      // Skip the recordings _tmp staging dir if it ever leaks into a
      // listing; its contents are not user-facing.
      if (name === "_tmp") continue;
      if (!FOLDER_SEGMENT_REGEX.test(name)) continue;
      folders.push({ name });
      continue;
    }
    if (!dirent.isFile()) continue;
    if (!fileRegex.test(name)) continue;
    const abs = path.join(absDir, name);
    let stat;
    try { stat = fs.statSync(abs); } catch (_e) { continue; }
    const meta = readMeta(abs);
    items.push({
      filename: name,
      sizeBytes: stat.size,
      tsMs: stat.mtimeMs,
      caption: typeof meta.caption === "string" ? meta.caption : "",
      author: typeof meta.author === "string" ? meta.author : "",
      durationMs: Number.isFinite(meta.durationMs) ? meta.durationMs : null,
      width: Number.isFinite(meta.width) ? meta.width : null,
      height: Number.isFinite(meta.height) ? meta.height : null,
      mimeType: typeof meta.mimeType === "string" ? meta.mimeType : null
    });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  items.sort((a, b) => b.tsMs - a.tsMs);
  return { folders, items };
}

// Walk every file (matching fileRegex) under vmRoot, including nested
// subfolders. Used by retention enforcement so the cap applies across
// the entire per-VM tree rather than per-folder.
function walkAssetFiles(absRoot, fileRegex) {
  const out = [];
  const stack = [absRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_e) { continue; }
    for (const dirent of entries) {
      const abs = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name === "_tmp") continue;
        stack.push(abs);
        continue;
      }
      if (!dirent.isFile()) continue;
      if (!fileRegex.test(dirent.name)) continue;
      try {
        const stat = fs.statSync(abs);
        out.push({ abs, tsMs: stat.mtimeMs });
      } catch (_e) { /* ignore */ }
    }
  }
  out.sort((a, b) => b.tsMs - a.tsMs);
  return out;
}

// Walks the tree under absRoot and returns a nested folder structure
// (files are not enumerated, only counted per folder). Used by the
// 3-pane Finder-style library browser to render the left tree pane in
// one shot rather than fetching each level on expand.
function walkAssetTree(absRoot, fileRegex) {
  function visit(absDir, name) {
    let entries = [];
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch (_e) { return { name, children: [], fileCount: 0 }; }
    const children = [];
    let fileCount = 0;
    for (const dirent of entries) {
      if (dirent.isDirectory()) {
        if (dirent.name === "_tmp") continue;
        if (!FOLDER_SEGMENT_REGEX.test(dirent.name)) continue;
        children.push(visit(path.join(absDir, dirent.name), dirent.name));
      } else if (dirent.isFile() && fileRegex.test(dirent.name)) {
        fileCount++;
      }
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    return { name, children, fileCount };
  }
  return visit(absRoot, "");
}

function enforceRetention(absRoot, fileRegex, max) {
  const all = walkAssetFiles(absRoot, fileRegex);
  if (all.length <= max) return 0;
  const overflow = all.slice(max);
  let pruned = 0;
  for (const item of overflow) {
    try { fs.unlinkSync(item.abs); pruned++; }
    catch (_e) { /* ignore */ }
    removeMeta(item.abs);
  }
  return pruned;
}

function clampCaption(value) {
  const s = typeof value === "string" ? value : "";
  if (Buffer.byteLength(s, "utf8") > MAX_CAPTION_BYTES) {
    // Truncate by characters; chunkier than byte-truncation but avoids
    // splitting a multibyte sequence in half.
    return s.slice(0, MAX_CAPTION_BYTES);
  }
  return s;
}

function isoStamp() {
  return new Date().toISOString().replace(/:/g, "-");
}

function relPathFor(baseDir, absFile) {
  return path.relative(process.cwd(), absFile) || baseDir;
}

// =====================================================================
// Per-VM screenshots. Available in both single- and multi-user modes.
// Browser captures `canvas.toBlob('image/png')` and POSTs the base64
// payload here; we write it under
// <SCREENSHOTS_DIR>/<uuid>[/<subfolder>...]/<ts>.png and prune oldest
// beyond NRCC_SCREENSHOT_MAX_PER_VM (counted across the whole tree).
// =====================================================================
app.post("/api/screenshots/:vmUuid", (req, res) => {
  const vmRoot = safeAssetDir(SCREENSHOTS_DIR, req.params.vmUuid, "");
  if (!vmRoot) return res.status(400).json({ error: "Invalid vmUuid." });
  const targetDir = safeAssetDir(SCREENSHOTS_DIR, req.params.vmUuid, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid folder." });

  let { pngBase64, caption } = req.body || {};
  if (typeof pngBase64 !== "string" || !pngBase64) {
    return res.status(400).json({ error: "Missing pngBase64 body." });
  }
  const commaIdx = pngBase64.indexOf(",");
  if (pngBase64.startsWith("data:") && commaIdx > 0) {
    pngBase64 = pngBase64.slice(commaIdx + 1);
  }
  if (pngBase64.length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: "Screenshot exceeds 10 MB limit." });
  }

  let buf;
  try { buf = Buffer.from(pngBase64, "base64"); }
  catch (_e) { return res.status(400).json({ error: "Invalid base64 payload." }); }
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return res.status(400).json({ error: "Payload is not a PNG." });
  }

  try { fs.mkdirSync(targetDir, { recursive: true }); }
  catch (err) {
    return res.status(500).json({ error: `Could not create folder: ${err.message}` });
  }

  const filename = `${isoStamp()}.png`;
  const fullPath = path.join(targetDir, filename);
  try { fs.writeFileSync(fullPath, buf); }
  catch (err) {
    return res.status(500).json({ error: `Could not write screenshot: ${err.message}` });
  }
  if (typeof caption === "string" && caption.trim()) {
    try {
      writeMeta(fullPath, {
        caption: clampCaption(caption),
        author: req.nrccSession?.currentUser || "",
        tsMs: Date.now()
      });
    } catch (_e) { /* best-effort */ }
  }

  let prunedCount = 0;
  try { prunedCount = enforceRetention(vmRoot, SCREENSHOT_FILENAME_REGEX, SCREENSHOT_MAX_PER_VM); }
  catch (_e) { /* best-effort */ }

  res.json({
    filename,
    folder: safeRelFolder(req.query.folder || "") || "",
    savedPath: relPathFor(SCREENSHOTS_DIR, fullPath),
    sizeBytes: buf.length,
    prunedCount
  });
});

app.get("/api/screenshots/:vmUuid", (req, res) => {
  const targetDir = safeAssetDir(SCREENSHOTS_DIR, req.params.vmUuid, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid vmUuid or folder." });
  try {
    const { folders, items } = listAssetEntries(targetDir, SCREENSHOT_FILENAME_REGEX);
    res.json({ folder: safeRelFolder(req.query.folder || "") || "", folders, items });
  } catch (err) {
    res.status(500).json({ error: `Could not list screenshots: ${err.message}` });
  }
});

// More-specific routes MUST be registered before the wildcard /:filename
// route below; otherwise Express's first-match-wins routing would let
// requests like DELETE /folders or PUT /meta hit the per-file handler
// (which would then reject the literal string "folders" / "meta" as a
// bad filename).
app.post("/api/screenshots/:vmUuid/folders", (req, res) => {
  return assetCreateFolder(req, res, SCREENSHOTS_DIR, req.params.vmUuid);
});
app.delete("/api/screenshots/:vmUuid/folders", (req, res) => {
  return assetDeleteFolder(req, res, SCREENSHOTS_DIR, req.params.vmUuid);
});
app.post("/api/screenshots/:vmUuid/move", (req, res) => {
  return assetMove(req, res, SCREENSHOTS_DIR, req.params.vmUuid, SCREENSHOT_FILENAME_REGEX);
});
app.put("/api/screenshots/:vmUuid/meta", (req, res) => {
  return assetSetCaption(req, res, SCREENSHOTS_DIR, req.params.vmUuid, SCREENSHOT_FILENAME_REGEX);
});
app.get("/api/screenshots/:vmUuid/tree", (req, res) => {
  const root = safeAssetDir(SCREENSHOTS_DIR, req.params.vmUuid, "");
  if (!root) return res.status(400).json({ error: "Invalid vmUuid." });
  try { res.json({ tree: walkAssetTree(root, SCREENSHOT_FILENAME_REGEX) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/screenshots/:vmUuid/:filename", (req, res) => {
  const targetDir = safeAssetDir(SCREENSHOTS_DIR, req.params.vmUuid, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid vmUuid or folder." });
  const filename = String(req.params.filename || "");
  if (!SCREENSHOT_FILENAME_REGEX.test(filename)) {
    return res.status(400).json({ error: "Invalid filename." });
  }
  const fullPath = path.join(targetDir, filename);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "Not found." });
  // ?download=1 forces an attachment disposition so the browser saves
  // the PNG rather than opening it inline (matches the recording route).
  const isDownload = String(req.query.download || "") === "1";
  if (isDownload) {
    res.set("Cache-Control", "no-store");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    res.set("Cache-Control", "private, max-age=300");
  }
  res.type("image/png");
  res.sendFile(fullPath);
});

app.delete("/api/screenshots/:vmUuid/:filename", (req, res) => {
  const targetDir = safeAssetDir(SCREENSHOTS_DIR, req.params.vmUuid, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid vmUuid or folder." });
  const filename = String(req.params.filename || "");
  if (!SCREENSHOT_FILENAME_REGEX.test(filename)) {
    return res.status(400).json({ error: "Invalid filename." });
  }
  const fullPath = path.join(targetDir, filename);
  try {
    fs.unlinkSync(fullPath);
    removeMeta(fullPath);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "Not found." });
    res.status(500).json({ error: `Could not delete: ${err.message}` });
  }
});

// =====================================================================
// Per-VM session recordings. Browser uses canvas.captureStream(fps) +
// MediaRecorder (WebM/VP9 with VP8 fallback) and uploads the data in
// 2-second chunks via /chunk. The server appends to a single temp file
// per recordingId, then renames it into place on /finish. Anything
// abandoned in _tmp older than 1h is swept by the periodic cleanup.
// =====================================================================
const RECORDING_TMP_DIR = path.join(RECORDINGS_DIR, "_tmp");
const RECORDING_TMP_TTL_MS = 60 * 60 * 1000;
// In-memory state keyed by recordingId. Lost on process restart, which
// also strands the matching _tmp file -- the periodic sweep deletes
// those.
const activeRecordings = new Map();

function assetCreateFolder(req, res, baseDir, vmUuid) {
  const folder = safeRelFolder((req.body || {}).path || "");
  if (folder === null || !folder) return res.status(400).json({ error: "Invalid folder path." });
  const target = safeAssetDir(baseDir, vmUuid, folder);
  if (!target) return res.status(400).json({ error: "Invalid folder path." });
  try {
    fs.mkdirSync(target, { recursive: true });
    res.json({ folder });
  } catch (err) {
    res.status(500).json({ error: `Could not create folder: ${err.message}` });
  }
}

function assetDeleteFolder(req, res, baseDir, vmUuid) {
  const folder = safeRelFolder((req.body || {}).path || "");
  if (folder === null || !folder) return res.status(400).json({ error: "Invalid folder path." });
  const target = safeAssetDir(baseDir, vmUuid, folder);
  if (!target) return res.status(400).json({ error: "Invalid folder path." });
  let entries;
  try { entries = fs.readdirSync(target); }
  catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "Not found." });
    return res.status(500).json({ error: `Could not read folder: ${err.message}` });
  }
  if (entries.length > 0) {
    return res.status(409).json({ error: "Folder is not empty." });
  }
  try {
    fs.rmdirSync(target);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Could not remove folder: ${err.message}` });
  }
}

function assetMove(req, res, baseDir, vmUuid, fileRegex) {
  const body = req.body || {};
  const fromFolder = safeRelFolder(body.fromFolder || "");
  const toFolder = safeRelFolder(body.toFolder || "");
  if (fromFolder === null || toFolder === null) {
    return res.status(400).json({ error: "Invalid folder path." });
  }
  const fromName = String(body.fromName || "");
  const toName = String(body.toName || fromName);
  if (!fromName) return res.status(400).json({ error: "Missing fromName." });
  // Two operating modes: file move/rename (matches fileRegex) or
  // folder move/rename (matches FOLDER_SEGMENT_REGEX, single-segment).
  const isFile = fileRegex.test(fromName);
  const isFolder = FOLDER_SEGMENT_REGEX.test(fromName) && !fileRegex.test(fromName);
  if (!isFile && !isFolder) return res.status(400).json({ error: "Invalid fromName." });
  if (isFile && !fileRegex.test(toName)) {
    return res.status(400).json({ error: "Invalid toName for file." });
  }
  if (isFolder && !FOLDER_SEGMENT_REGEX.test(toName)) {
    return res.status(400).json({ error: "Invalid toName for folder." });
  }
  const fromDir = safeAssetDir(baseDir, vmUuid, fromFolder);
  const toDir = safeAssetDir(baseDir, vmUuid, toFolder);
  if (!fromDir || !toDir) return res.status(400).json({ error: "Invalid folder." });
  const fromAbs = path.join(fromDir, fromName);
  const toAbs = path.join(toDir, toName);
  if (!fs.existsSync(fromAbs)) return res.status(404).json({ error: "Source not found." });
  if (fs.existsSync(toAbs)) return res.status(409).json({ error: "Destination already exists." });
  try {
    fs.mkdirSync(toDir, { recursive: true });
    fs.renameSync(fromAbs, toAbs);
    if (isFile) {
      const fromMeta = metaPathFor(fromAbs);
      if (fs.existsSync(fromMeta)) {
        try { fs.renameSync(fromMeta, metaPathFor(toAbs)); } catch (_e) { /* ignore */ }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Could not move: ${err.message}` });
  }
}

function assetSetCaption(req, res, baseDir, vmUuid, fileRegex) {
  const body = req.body || {};
  const folder = safeRelFolder(body.folder || "");
  if (folder === null) return res.status(400).json({ error: "Invalid folder." });
  const filename = String(body.filename || "");
  if (!fileRegex.test(filename)) return res.status(400).json({ error: "Invalid filename." });
  const target = safeAssetDir(baseDir, vmUuid, folder);
  if (!target) return res.status(400).json({ error: "Invalid folder." });
  const abs = path.join(target, filename);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found." });
  try {
    if (typeof body.caption !== "string") {
      return res.status(400).json({ error: "Missing caption." });
    }
    const caption = clampCaption(body.caption);
    if (caption === "") {
      removeMeta(abs);
      return res.json({ caption: "" });
    }
    const meta = writeMeta(abs, {
      caption,
      author: req.nrccSession?.currentUser || "",
      tsMs: Date.now()
    });
    res.json({ caption: meta.caption });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

app.post("/api/recordings/:vmUuid/start", (req, res) => {
  const vmRoot = safeAssetDir(RECORDINGS_DIR, req.params.vmUuid, "");
  if (!vmRoot) return res.status(400).json({ error: "Invalid vmUuid." });
  const folder = safeRelFolder((req.body || {}).folder || "");
  if (folder === null) return res.status(400).json({ error: "Invalid folder." });
  const targetDir = safeAssetDir(RECORDINGS_DIR, req.params.vmUuid, folder);
  if (!targetDir) return res.status(400).json({ error: "Invalid folder." });

  const body = req.body || {};
  const fps = Math.max(1, Math.min(60, Number(body.fps) || RECORDING_FPS));
  const width = Math.max(0, Math.min(8192, Number(body.width) || 0));
  const height = Math.max(0, Math.min(8192, Number(body.height) || 0));
  const mimeRaw = typeof body.mimeType === "string" ? body.mimeType : "";
  const mimeType = /^video\/webm/i.test(mimeRaw) ? mimeRaw : "video/webm";

  try { fs.mkdirSync(RECORDING_TMP_DIR, { recursive: true }); }
  catch (err) {
    return res.status(500).json({ error: `Could not create temp dir: ${err.message}` });
  }
  const recordingId = crypto.randomUUID();
  const tmpPath = path.join(RECORDING_TMP_DIR, `${recordingId}.webm`);
  try {
    fs.writeFileSync(tmpPath, Buffer.alloc(0));
  } catch (err) {
    return res.status(500).json({ error: `Could not allocate temp file: ${err.message}` });
  }
  activeRecordings.set(recordingId, {
    vmUuid: safeVmUuid(req.params.vmUuid),
    folder,
    fps,
    width,
    height,
    mimeType,
    tmpPath,
    bytesWritten: 0,
    startedAt: Date.now(),
    author: req.nrccSession?.currentUser || ""
  });
  res.json({ recordingId, fps, mimeType, maxBytes: RECORDING_MAX_BYTES });
});

// Chunks come in as raw octet-stream so we can append them straight to
// disk without going through JSON or base64. The 8 MB cap matches the
// per-chunk budget the client uses (2-second slices at the configured
// bitrate stay well under this).
app.post(
  "/api/recordings/:vmUuid/chunk",
  express.raw({ type: "application/octet-stream", limit: "8mb" }),
  (req, res) => {
    if (!safeVmUuid(req.params.vmUuid)) {
      return res.status(400).json({ error: "Invalid vmUuid." });
    }
    const recordingId = String(req.query.recordingId || "");
    const state = activeRecordings.get(recordingId);
    if (!state || state.vmUuid !== safeVmUuid(req.params.vmUuid)) {
      return res.status(404).json({ error: "Recording not found." });
    }
    const chunk = req.body;
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      return res.status(400).json({ error: "Empty chunk." });
    }
    if (state.bytesWritten + chunk.length > RECORDING_MAX_BYTES) {
      try { fs.unlinkSync(state.tmpPath); } catch (_e) { /* ignore */ }
      activeRecordings.delete(recordingId);
      return res.status(413).json({ error: "Recording exceeded max bytes; aborted." });
    }
    try {
      fs.appendFileSync(state.tmpPath, chunk);
      state.bytesWritten += chunk.length;
      res.json({ bytesWritten: state.bytesWritten });
    } catch (err) {
      res.status(500).json({ error: `Could not append chunk: ${err.message}` });
    }
  }
);

app.post("/api/recordings/:vmUuid/finish", (req, res) => {
  if (!safeVmUuid(req.params.vmUuid)) {
    return res.status(400).json({ error: "Invalid vmUuid." });
  }
  const body = req.body || {};
  const recordingId = String(body.recordingId || "");
  const state = activeRecordings.get(recordingId);
  if (!state || state.vmUuid !== safeVmUuid(req.params.vmUuid)) {
    return res.status(404).json({ error: "Recording not found." });
  }
  activeRecordings.delete(recordingId);
  if (state.bytesWritten === 0) {
    try { fs.unlinkSync(state.tmpPath); } catch (_e) { /* ignore */ }
    return res.status(400).json({ error: "No data captured." });
  }
  // EBML magic for WebM / Matroska is 0x1A 0x45 0xDF 0xA3.
  let magic;
  try {
    const fd = fs.openSync(state.tmpPath, "r");
    magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    fs.closeSync(fd);
  } catch (err) {
    try { fs.unlinkSync(state.tmpPath); } catch (_e) { /* ignore */ }
    return res.status(500).json({ error: `Could not read temp file: ${err.message}` });
  }
  if (magic[0] !== 0x1a || magic[1] !== 0x45 || magic[2] !== 0xdf || magic[3] !== 0xa3) {
    try { fs.unlinkSync(state.tmpPath); } catch (_e) { /* ignore */ }
    return res.status(400).json({ error: "Payload is not a WebM file." });
  }

  const targetDir = safeAssetDir(RECORDINGS_DIR, state.vmUuid, state.folder);
  if (!targetDir) {
    try { fs.unlinkSync(state.tmpPath); } catch (_e) { /* ignore */ }
    return res.status(400).json({ error: "Invalid target folder." });
  }
  try { fs.mkdirSync(targetDir, { recursive: true }); }
  catch (err) {
    return res.status(500).json({ error: `Could not create folder: ${err.message}` });
  }
  const filename = `${isoStamp()}.webm`;
  const fullPath = path.join(targetDir, filename);
  try { fs.renameSync(state.tmpPath, fullPath); }
  catch (err) {
    return res.status(500).json({ error: `Could not finalize recording: ${err.message}` });
  }
  const durationMs = Math.max(0, Number(body.durationMs) || (Date.now() - state.startedAt));
  try {
    writeMeta(fullPath, {
      caption: typeof body.caption === "string" ? clampCaption(body.caption) : "",
      author: state.author,
      startedAt: state.startedAt,
      endedAt: Date.now(),
      durationMs,
      sizeBytes: state.bytesWritten,
      fps: state.fps,
      width: state.width || null,
      height: state.height || null,
      mimeType: state.mimeType
    });
  } catch (_e) { /* meta failure is non-fatal */ }

  let prunedCount = 0;
  const vmRoot = safeAssetDir(RECORDINGS_DIR, state.vmUuid, "");
  if (vmRoot) {
    try { prunedCount = enforceRetention(vmRoot, RECORDING_FILENAME_REGEX, RECORDING_MAX_PER_VM); }
    catch (_e) { /* best-effort */ }
  }
  res.json({
    filename,
    folder: state.folder,
    durationMs,
    sizeBytes: state.bytesWritten,
    prunedCount
  });
});

app.post("/api/recordings/:vmUuid/abort", (req, res) => {
  if (!safeVmUuid(req.params.vmUuid)) {
    return res.status(400).json({ error: "Invalid vmUuid." });
  }
  const recordingId = String((req.body || {}).recordingId || "");
  const state = activeRecordings.get(recordingId);
  if (state && state.vmUuid === safeVmUuid(req.params.vmUuid)) {
    activeRecordings.delete(recordingId);
    try { fs.unlinkSync(state.tmpPath); } catch (_e) { /* ignore */ }
  }
  res.json({ ok: true });
});

app.get("/api/recordings/:vmUuid", (req, res) => {
  const targetDir = safeAssetDir(RECORDINGS_DIR, req.params.vmUuid, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid vmUuid or folder." });
  try {
    const { folders, items } = listAssetEntries(targetDir, RECORDING_FILENAME_REGEX);
    res.json({ folder: safeRelFolder(req.query.folder || "") || "", folders, items });
  } catch (err) {
    res.status(500).json({ error: `Could not list recordings: ${err.message}` });
  }
});

// Range-aware streaming so the browser <video> element can seek
// without downloading the whole file first. Express's res.sendFile
// already speaks Range, but we hand-roll the response to keep
// Cache-Control + Content-Type tightly controlled.
app.get("/api/recordings/:vmUuid/file", (req, res) => {
  const targetDir = safeAssetDir(RECORDINGS_DIR, req.params.vmUuid, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid vmUuid or folder." });
  const filename = String(req.query.filename || "");
  if (!RECORDING_FILENAME_REGEX.test(filename)) {
    return res.status(400).json({ error: "Invalid filename." });
  }
  const fullPath = path.join(targetDir, filename);
  let stat;
  try { stat = fs.statSync(fullPath); }
  catch (_e) { return res.status(404).json({ error: "Not found." }); }

  // ?download=1 forces a full 200 response with an attachment disposition.
  // Without this, the inline <video> element fetches the file with Range
  // requests (HTTP 206) and the browser's download manager refuses to
  // save the cached partial content, surfacing "Failed to Download".
  const isDownload = String(req.query.download || "") === "1";
  res.set("Content-Type", "video/webm");
  if (isDownload) {
    res.set("Cache-Control", "no-store");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.set("Content-Length", String(stat.size));
    return fs.createReadStream(fullPath).pipe(res);
  }

  const range = req.headers.range;
  res.set("Cache-Control", "private, max-age=300");
  res.set("Accept-Ranges", "bytes");
  if (!range) {
    res.set("Content-Length", String(stat.size));
    return fs.createReadStream(fullPath).pipe(res);
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) return res.status(416).end();
  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
    res.status(416).set("Content-Range", `bytes */${stat.size}`).end();
    return;
  }
  res.status(206);
  res.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  res.set("Content-Length", String(end - start + 1));
  fs.createReadStream(fullPath, { start, end }).pipe(res);
});

app.delete("/api/recordings/:vmUuid/file", (req, res) => {
  const targetDir = safeAssetDir(RECORDINGS_DIR, req.params.vmUuid, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid vmUuid or folder." });
  const filename = String(req.query.filename || "");
  if (!RECORDING_FILENAME_REGEX.test(filename)) {
    return res.status(400).json({ error: "Invalid filename." });
  }
  const fullPath = path.join(targetDir, filename);
  try {
    fs.unlinkSync(fullPath);
    removeMeta(fullPath);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "Not found." });
    res.status(500).json({ error: `Could not delete: ${err.message}` });
  }
});

app.post("/api/recordings/:vmUuid/folders", (req, res) => {
  return assetCreateFolder(req, res, RECORDINGS_DIR, req.params.vmUuid);
});
app.delete("/api/recordings/:vmUuid/folders", (req, res) => {
  return assetDeleteFolder(req, res, RECORDINGS_DIR, req.params.vmUuid);
});
app.post("/api/recordings/:vmUuid/move", (req, res) => {
  return assetMove(req, res, RECORDINGS_DIR, req.params.vmUuid, RECORDING_FILENAME_REGEX);
});
app.put("/api/recordings/:vmUuid/meta", (req, res) => {
  return assetSetCaption(req, res, RECORDINGS_DIR, req.params.vmUuid, RECORDING_FILENAME_REGEX);
});
app.get("/api/recordings/:vmUuid/tree", (req, res) => {
  const root = safeAssetDir(RECORDINGS_DIR, req.params.vmUuid, "");
  if (!root) return res.status(400).json({ error: "Invalid vmUuid." });
  try { res.json({ tree: walkAssetTree(root, RECORDING_FILENAME_REGEX) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Sweep abandoned chunked-upload temp files so a crashed browser
// doesn't leak disk space. Runs once on boot and once per hour.
function sweepRecordingTmp() {
  let entries;
  try { entries = fs.readdirSync(RECORDING_TMP_DIR); }
  catch (_e) { return; }
  const now = Date.now();
  for (const name of entries) {
    if (!/^[\w-]+\.webm$/.test(name)) continue;
    const abs = path.join(RECORDING_TMP_DIR, name);
    try {
      const stat = fs.statSync(abs);
      if (now - stat.mtimeMs > RECORDING_TMP_TTL_MS) fs.unlinkSync(abs);
    } catch (_e) { /* ignore */ }
  }
}
sweepRecordingTmp();
setInterval(sweepRecordingTmp, 60 * 60 * 1000);

// =====================================================================
// Global script library. Plain-text snippets the user can copy to the
// clipboard from the browser. "Global" here is literal: every signed-in
// user can read, write, edit, and delete every script. There is no
// per-user namespace and no role gating -- consistent with the rest of
// NRCC, which already trusts every authenticated session equally.
// =====================================================================
function slugifyLabel(label) {
  const cleaned = String(label || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!cleaned) return null;
  return cleaned;
}

function uniqueScriptFilename(targetDir, baseSlug) {
  let candidate = `${baseSlug}.txt`;
  let n = 2;
  while (fs.existsSync(path.join(targetDir, candidate))) {
    candidate = `${baseSlug}-${n}.txt`;
    n++;
    if (n > 9999) {
      candidate = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}.txt`;
      break;
    }
  }
  return candidate;
}

function readScriptMeta(absFile) {
  const meta = readMeta(absFile);
  return {
    label: typeof meta.label === "string" ? meta.label : "",
    description: typeof meta.description === "string" ? meta.description : "",
    language: typeof meta.language === "string" ? meta.language : "",
    author: typeof meta.author === "string" ? meta.author : "",
    tsMs: Number.isFinite(meta.tsMs) ? meta.tsMs : null
  };
}

function listScriptEntries(absDir) {
  let names;
  try { names = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch (err) {
    if (err.code === "ENOENT") return { folders: [], items: [] };
    throw err;
  }
  const folders = [];
  const items = [];
  for (const dirent of names) {
    const name = dirent.name;
    if (dirent.isDirectory()) {
      if (!FOLDER_SEGMENT_REGEX.test(name)) continue;
      folders.push({ name });
      continue;
    }
    if (!dirent.isFile()) continue;
    if (!SCRIPT_FILENAME_REGEX.test(name)) continue;
    const abs = path.join(absDir, name);
    let stat;
    try { stat = fs.statSync(abs); } catch (_e) { continue; }
    const meta = readScriptMeta(abs);
    items.push({
      filename: name,
      label: meta.label || name.replace(/\.txt$/, ""),
      description: meta.description,
      language: meta.language,
      author: meta.author,
      sizeBytes: stat.size,
      tsMs: stat.mtimeMs
    });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  items.sort((a, b) => a.label.localeCompare(b.label));
  return { folders, items };
}

app.get("/api/scripts", (req, res) => {
  const targetDir = safeAssetDir(SCRIPTS_DIR, null, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid folder." });
  try {
    const { folders, items } = listScriptEntries(targetDir);
    res.json({ folder: safeRelFolder(req.query.folder || "") || "", folders, items });
  } catch (err) {
    res.status(500).json({ error: `Could not list scripts: ${err.message}` });
  }
});

app.get("/api/scripts/file", (req, res) => {
  const targetDir = safeAssetDir(SCRIPTS_DIR, null, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid folder." });
  const filename = String(req.query.filename || "");
  if (!SCRIPT_FILENAME_REGEX.test(filename)) {
    return res.status(400).json({ error: "Invalid filename." });
  }
  const abs = path.join(targetDir, filename);
  let body;
  try { body = fs.readFileSync(abs, "utf8"); }
  catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "Not found." });
    return res.status(500).json({ error: `Could not read script: ${err.message}` });
  }
  const meta = readScriptMeta(abs);
  res.json({
    filename,
    folder: safeRelFolder(req.query.folder || "") || "",
    body,
    label: meta.label || filename.replace(/\.txt$/, ""),
    description: meta.description,
    language: meta.language,
    author: meta.author,
    tsMs: meta.tsMs
  });
});

app.post("/api/scripts", (req, res) => {
  const body = req.body || {};
  const folder = safeRelFolder(body.folder || "");
  if (folder === null) return res.status(400).json({ error: "Invalid folder." });
  const targetDir = safeAssetDir(SCRIPTS_DIR, null, folder);
  if (!targetDir) return res.status(400).json({ error: "Invalid folder." });
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const slug = slugifyLabel(label);
  if (!slug) return res.status(400).json({ error: "Label is required." });
  const text = typeof body.body === "string" ? body.body : "";
  if (Buffer.byteLength(text, "utf8") > SCRIPT_MAX_BYTES) {
    return res.status(413).json({ error: "Script body exceeds size limit." });
  }
  try { fs.mkdirSync(targetDir, { recursive: true }); }
  catch (err) {
    return res.status(500).json({ error: `Could not create folder: ${err.message}` });
  }
  const filename = uniqueScriptFilename(targetDir, slug);
  const abs = path.join(targetDir, filename);
  try {
    fs.writeFileSync(abs, text, { mode: 0o644 });
    writeMeta(abs, {
      label,
      description: typeof body.description === "string" ? body.description : "",
      language: typeof body.language === "string" ? body.language : "",
      author: req.nrccSession?.currentUser || "",
      tsMs: Date.now()
    });
    res.json({ folder, filename, label });
  } catch (err) {
    res.status(500).json({ error: `Could not write script: ${err.message}` });
  }
});

app.put("/api/scripts/file", (req, res) => {
  const body = req.body || {};
  const folder = safeRelFolder(body.folder || "");
  if (folder === null) return res.status(400).json({ error: "Invalid folder." });
  const targetDir = safeAssetDir(SCRIPTS_DIR, null, folder);
  if (!targetDir) return res.status(400).json({ error: "Invalid folder." });
  const filename = String(body.filename || "");
  if (!SCRIPT_FILENAME_REGEX.test(filename)) {
    return res.status(400).json({ error: "Invalid filename." });
  }
  const abs = path.join(targetDir, filename);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "Not found." });

  let finalAbs = abs;
  let finalFilename = filename;
  if (typeof body.label === "string" && body.label.trim()) {
    const slug = slugifyLabel(body.label);
    const expected = `${slug}.txt`;
    if (slug && expected !== filename) {
      const renamed = uniqueScriptFilename(targetDir, slug);
      const renamedAbs = path.join(targetDir, renamed);
      try {
        fs.renameSync(abs, renamedAbs);
        const fromMeta = metaPathFor(abs);
        if (fs.existsSync(fromMeta)) {
          try { fs.renameSync(fromMeta, metaPathFor(renamedAbs)); } catch (_e) { /* ignore */ }
        }
        finalAbs = renamedAbs;
        finalFilename = renamed;
      } catch (err) {
        return res.status(500).json({ error: `Could not rename: ${err.message}` });
      }
    }
  }

  if (typeof body.body === "string") {
    if (Buffer.byteLength(body.body, "utf8") > SCRIPT_MAX_BYTES) {
      return res.status(413).json({ error: "Script body exceeds size limit." });
    }
    try { fs.writeFileSync(finalAbs, body.body, { mode: 0o644 }); }
    catch (err) {
      return res.status(500).json({ error: `Could not write script: ${err.message}` });
    }
  }
  const patch = {
    author: req.nrccSession?.currentUser || "",
    tsMs: Date.now()
  };
  if (typeof body.label === "string") patch.label = body.label;
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.language === "string") patch.language = body.language;
  try { writeMeta(finalAbs, patch); }
  catch (err) { /* meta failure is non-fatal */ }
  res.json({ folder, filename: finalFilename });
});

app.delete("/api/scripts/file", (req, res) => {
  const targetDir = safeAssetDir(SCRIPTS_DIR, null, req.query.folder || "");
  if (!targetDir) return res.status(400).json({ error: "Invalid folder." });
  const filename = String(req.query.filename || "");
  if (!SCRIPT_FILENAME_REGEX.test(filename)) {
    return res.status(400).json({ error: "Invalid filename." });
  }
  const abs = path.join(targetDir, filename);
  try {
    fs.unlinkSync(abs);
    removeMeta(abs);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "Not found." });
    res.status(500).json({ error: `Could not delete: ${err.message}` });
  }
});

app.post("/api/scripts/folders", (req, res) => {
  return assetCreateFolder(req, res, SCRIPTS_DIR, null);
});
app.delete("/api/scripts/folders", (req, res) => {
  return assetDeleteFolder(req, res, SCRIPTS_DIR, null);
});
app.post("/api/scripts/move", (req, res) => {
  return assetMove(req, res, SCRIPTS_DIR, null, SCRIPT_FILENAME_REGEX);
});


function normalizePrismHost(value) {
  const host = String(value || "").trim();
  if (!host) return "";
  // Accept plain hostnames, FQDNs, and IPv4/IPv6 literals (optionally
  // wrapped as [ipv6]). Reject schemes, paths, credentials, and ports.
  if (host.includes("://") || host.includes("/") || host.includes("@")) {
    throw new Error("Invalid Prism host format.");
  }
  const bracketedIpv6 = /^\[[0-9a-fA-F:.]+\]$/;
  const bareIpv6 = /^[0-9a-fA-F:.]+$/;
  const hostnameOrIpv4 = /^[A-Za-z0-9.-]+$/;
  if (
    !hostnameOrIpv4.test(host) &&
    !bracketedIpv6.test(host) &&
    !bareIpv6.test(host)
  ) {
    throw new Error("Invalid Prism host format.");
  }
  return host;
}

function resolveAuth(body) {
  const pcHost = normalizePrismHost(body.pcHost || process.env.NUTANIX_PC_HOST || "");
  const username = (body.username || process.env.NUTANIX_USERNAME || "").trim();
  const password = body.password || process.env.NUTANIX_PASSWORD || "";
  const tlsSkipVerify =
    typeof body.tlsSkipVerify === "boolean"
      ? body.tlsSkipVerify
      : process.env.NUTANIX_TLS_SKIP_VERIFY === "true";
  const includeHiddenVms =
    typeof body.includeHiddenVms === "boolean" ? body.includeHiddenVms : true;

  return { pcHost, username, password, tlsSkipVerify, includeHiddenVms };
}

function createPrismClient(pcHost, username, password, tlsSkipVerify) {
  const client = axios.create({
    auth: { username, password },
    headers: { "Content-Type": "application/json" },
    timeout: PRISM_HTTP_TIMEOUT_MS,
    // Lab-only: allow self-signed certs when explicitly enabled.
    httpsAgent: new https.Agent({
      rejectUnauthorized: !tlsSkipVerify
    }),
    baseURL: `https://${pcHost}:9440`
  });

  client.interceptors.request.use((config) => {
    const reqId = crypto.randomUUID();
    config.headers = config.headers || {};
    // Some Prism builds validate one of these request-id headers.
    config.headers["NTNX-Request-Id"] = reqId;
    config.headers["X-Request-Id"] = reqId;
    return config;
  });

  return client;
}

function createCookieClient(pcHost, sessionCookie, tlsSkipVerify) {
  const client = axios.create({
    headers: {
      Cookie: sessionCookie
    },
    timeout: 12000,
    httpsAgent: new https.Agent({
      rejectUnauthorized: !tlsSkipVerify
    }),
    baseURL: `https://${pcHost}:9440`
  });
  client.interceptors.request.use((config) => {
    const reqId = crypto.randomUUID();
    config.headers = config.headers || {};
    config.headers["NTNX-Request-Id"] = reqId;
    config.headers["X-Request-Id"] = reqId;
    return config;
  });
  return client;
}

function extractCookieHeader(setCookieHeader) {
  if (!Array.isArray(setCookieHeader)) {
    return "";
  }
  return setCookieHeader
    .map((cookie) => String(cookie).split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function createPrismSessionCookie(client, username, password) {
  try {
    const resp = await client.post("/api/nutanix/v3/users/login", {
      username,
      password
    });
    return extractCookieHeader(resp.headers?.["set-cookie"]);
  } catch (_error) {
    return "";
  }
}

async function createPrismLegacySessionCookie(client, username, password) {
  // PE PrismGateway endpoints: try a few that are known to set session
  // cookies. j_spring_security_check is the most common, and it accepts
  // form-urlencoded credentials.
  const candidates = [
    {
      url: "/PrismGateway/j_spring_security_check",
      contentType: "application/x-www-form-urlencoded",
      body: `j_username=${encodeURIComponent(username)}&j_password=${encodeURIComponent(password)}`
    },
    {
      url: "/PrismGateway/services/rest/v1/utils/loginActions",
      contentType: "application/json",
      body: JSON.stringify({})
    },
    {
      url: "/api/nutanix/v3/users/login",
      contentType: "application/json",
      body: JSON.stringify({ username, password })
    }
  ];
  for (const c of candidates) {
    try {
      const resp = await client.post(c.url, c.body, {
        headers: { "Content-Type": c.contentType },
        // We don't care about non-2xx for j_spring (often 302 to /console/login).
        validateStatus: () => true,
        timeout: 7000
      });
      const cookie = extractCookieHeader(resp.headers?.["set-cookie"]);
      if (cookie) {
        console.log(
          `[pe-legacy-auth] cookie obtained via ${c.url} status=${resp.status}`
        );
        return cookie;
      }
    } catch (_error) {
      // Try next.
    }
  }
  console.log("[pe-legacy-auth] no session cookie obtained");
  return "";
}

function collectVmIpAddresses(vm) {
  const out = new Set();
  const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  const visit = (node, parentKey) => {
    if (node == null) return;
    // Plain IPv4 string under an IP-shaped key. This covers the common
    // v4 AHV shape `nics[].networkInfo.ipv4Info.learnedIpAddresses:
    // ["10.0.0.5"]` (each array element lands here as `parentKey =
    // "learnedIpAddresses"`).
    if (typeof node === "string") {
      if (IPV4_LITERAL.test(node) && parentKey && /(ip|address)/i.test(parentKey)) {
        out.add(node);
      }
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      // Inherit the parent key so a `learnedIpAddresses: ["1.2.3.4"]`
      // array passes the IP-shaped-key test for each element.
      node.forEach((child) => visit(child, parentKey));
      return;
    }
    // Object: pick up direct IP-shaped strings AND recurse into
    // children (covers `ipAddress: { value: "1.2.3.4" }`,
    // `ipv4Config.ipAddress.value`, etc).
    for (const [key, val] of Object.entries(node)) {
      if (
        typeof val === "string" &&
        IPV4_LITERAL.test(val) &&
        /(ip|address|value)/i.test(key) &&
        // The parent key has to look IP-related so we don't slurp
        // unrelated fields like `metadata.uuid` (no IPv4 hits there
        // anyway, but belt and braces).
        (/(ip|address)/i.test(key) || /(ip|address)/i.test(parentKey || ""))
      ) {
        out.add(val);
      } else if (val && typeof val === "object") {
        visit(val, key);
      }
    }
  };
  // Look at the most likely locations first to avoid sweeping unrelated fields.
  const roots = [
    vm?.nics,
    vm?.spec?.resources?.nic_list,
    vm?.status?.resources?.nic_list,
    vm?.spec?.resources?.nicList,
    vm?.status?.resources?.nicList,
    vm?.networkConfig,
    vm?.networkInfo
  ];
  roots.forEach((root) => visit(root, ""));
  // Fallback: scan the whole record. Cheap for these small objects
  // and catches less-common shapes like
  // `vm.vm_nics[i].ip_endpoint_list[i].ip` that PE legacy hosts emit.
  if (out.size === 0) visit(vm, "");
  return Array.from(out);
}

// Quick visibility into Prism IP-reporting coverage. Logged once per
// /api/vms response so an operator can tell at a glance whether the
// IP parser is keeping up with the VMs the cluster has, and how
// many VMs are simply IP-less from Prism's point of view (no IPAM
// lease, no NGT, etc.).
function logIpCoverage(vms, variant, withCvm) {
  if (!Array.isArray(vms) || !vms.length) return;
  let withIp = 0;
  let withoutIp = 0;
  const samples = [];
  for (const vm of vms) {
    const ips = Array.isArray(vm.ipAddresses) ? vm.ipAddresses : [];
    if (ips.length) {
      withIp += 1;
      if (samples.length < 3) samples.push(`${vm.name}=${ips[0]}`);
    } else {
      withoutIp += 1;
    }
  }
  console.log(`[ip-coverage] variant=${variant || "default"} cvm-pass=${withCvm} total=${vms.length} withIp=${withIp} withoutIp=${withoutIp} samples=[${samples.join(", ")}]`);
}

function normalizeVmCategoryEntries(...sources) {
  const out = [];
  const add = (key, value) => {
    if (!key || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) add(key, item);
      return;
    }
    const v = String(value).trim();
    if (v) out.push(`${String(key).trim()}:${v}`);
  };
  for (const source of sources) {
    if (!source) continue;
    if (Array.isArray(source)) {
      for (const item of source) {
        if (typeof item === "string") {
          out.push(item);
        } else if (item && typeof item === "object") {
          const key =
            item.key ||
            item.name ||
            item.categoryKey ||
            item.category_key ||
            item.categoryName ||
            item.category_name;
          const value =
            item.value ||
            item.categoryValue ||
            item.category_value ||
            item.categoryValueName ||
            item.category_value_name;
          add(key, value);
        }
      }
    } else if (source && typeof source === "object") {
      for (const [key, value] of Object.entries(source)) add(key, value);
    }
  }
  return Array.from(new Set(out));
}

function parseVmList(vmResponse) {
  const list =
    vmResponse?.data?.data?.entities ||
    vmResponse?.data?.data ||
    vmResponse?.data?.entities ||
    vmResponse?.data?.vms ||
    vmResponse?.data ||
    [];
  const vms = Array.isArray(list) ? list : [];
  return vms
    .map((vm) => {
      const categories = normalizeVmCategoryEntries(
        vm?.categories,
        vm?.categories_mapping,
        vm?.categoriesMapping,
        vm?.categoryReferences,
        vm?.category_reference_list,
        vm?.metadata?.categories,
        vm?.metadata?.categories_mapping,
        vm?.metadata?.categoriesMapping,
        vm?.metadata?.categoryReferences,
        vm?.metadata?.category_reference_list,
        vm?.status?.resources?.categories,
        vm?.status?.resources?.categories_mapping,
        vm?.status?.resources?.categoriesMapping,
        vm?.status?.resources?.categoryReferences,
        vm?.status?.resources?.category_reference_list,
        vm?.spec?.resources?.categories,
        vm?.spec?.resources?.categories_mapping,
        vm?.spec?.resources?.categoriesMapping,
        vm?.spec?.resources?.categoryReferences,
        vm?.spec?.resources?.category_reference_list,
        vm?.spec?.categories,
        vm?.spec?.categories_mapping,
        vm?.spec?.categoriesMapping,
        vm?.spec?.categoryReferences,
        vm?.spec?.category_reference_list
      );

      const resolvedName =
        vm?.name ||
        vm?.spec?.name ||
        vm?.spec?.resources?.name ||
        vm?.status?.name ||
        vm?.status?.resources?.name ||
        vm?.metadata?.name ||
        vm?.vmName ||
        "Unnamed VM";

      const ipAddresses = collectVmIpAddresses(vm);
      return {
        uuid:
          vm?.extId ||
          vm?.id ||
          vm?.uuid ||
          vm?.metadata?.uuid ||
          vm?.status?.resources?.uuid ||
          "",
        name: resolvedName,
        powerState:
          vm?.status?.resources?.powerState ||
          vm?.powerState ||
          vm?.status?.powerState ||
          "UNKNOWN",
        isHidden:
          Boolean(vm?.isHidden) ||
          Boolean(vm?.status?.resources?.isHidden) ||
          Boolean(vm?.spec?.resources?.isHidden),
        isControllerVm:
          Boolean(vm?.isControllerVm) ||
          Boolean(vm?.status?.resources?.isControllerVm) ||
          Boolean(vm?.spec?.resources?.isControllerVm) ||
          /(^|[-_ ])cvm([-_ ]|$)/i.test(String(resolvedName)) ||
          /-cvm$/i.test(String(resolvedName)),
        isFsvm:
          /(^|[-_ ])fsvm([-_ ]|$)/i.test(String(resolvedName)) ||
          /(file|files)[-_ ]server/i.test(String(resolvedName)),
        categories,
        ipAddresses,
        ipAddress: ipAddresses[0]
      };
    })
    .filter((vm) => vm.uuid)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function categoriesFromVmDetail(vm) {
  if (!vm || typeof vm !== "object") return [];
  return normalizeVmCategoryEntries(
    vm?.categories,
    vm?.categories_mapping,
    vm?.categoriesMapping,
    vm?.categoryReferences,
    vm?.category_reference_list,
    vm?.metadata?.categories,
    vm?.metadata?.categories_mapping,
    vm?.metadata?.categoriesMapping,
    vm?.metadata?.categoryReferences,
    vm?.metadata?.category_reference_list,
    vm?.status?.resources?.categories,
    vm?.status?.resources?.categories_mapping,
    vm?.status?.resources?.categoriesMapping,
    vm?.status?.resources?.categoryReferences,
    vm?.status?.resources?.category_reference_list,
    vm?.spec?.resources?.categories,
    vm?.spec?.resources?.categories_mapping,
    vm?.spec?.resources?.categoriesMapping,
    vm?.spec?.resources?.categoryReferences,
    vm?.spec?.resources?.category_reference_list,
    vm?.spec?.categories,
    vm?.spec?.categories_mapping,
    vm?.spec?.categoriesMapping,
    vm?.spec?.categoryReferences,
    vm?.spec?.category_reference_list
  );
}

function mergeFolderCategory(categories, folderPath) {
  const existing = Array.isArray(categories) ? categories : [];
  const prefix = `${FOLDER_CATEGORY_KEY}:`;
  const rest = existing.filter((entry) => typeof entry !== "string" || !entry.startsWith(prefix));
  const normalized = normalizeFolderPath(folderPath);
  return normalized ? [...rest, `${FOLDER_CATEGORY_KEY}:${normalized}`] : rest;
}

async function hydrateVmFolderCategories(client, vms) {
  if (!VM_FOLDERS_ENABLED || !Array.isArray(vms) || !vms.length) return vms;
  const queue = vms.slice();
  let hydrated = 0;
  let failed = 0;
  const worker = async () => {
    while (queue.length) {
      const vm = queue.shift();
      if (!vm?.uuid) continue;
      try {
        const resp = await client.get(`/api/nutanix/v3/vms/${encodeURIComponent(vm.uuid)}`, {
          timeout: PRISM_HTTP_TIMEOUT_MS
        });
        const detail = resp.data || {};
        const folderPath = folderPathFromCategories(categoriesFromVmDetail(detail));
        vm.categories = mergeFolderCategory(vm.categories, folderPath);
        if (folderPath) hydrated += 1;
      } catch (_err) {
        // Some special/hidden entities can fail v3 detail lookup. Keep
        // the list result rather than failing the entire inventory.
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, vms.length) }, () => worker()));
  if (hydrated || failed) {
    console.log(`[vm-folders] hydrated folder categories for ${hydrated} VM(s); detail failures=${failed}`);
  }
  return vms;
}

function parseGenericEntityList(response) {
  const list =
    response?.data?.data?.entities ||
    response?.data?.data ||
    response?.data?.entities ||
    response?.data ||
    [];
  return Array.isArray(list) ? list : [];
}

// =====================================================================
// VM folder helpers (beta feature: vmFolders)
// =====================================================================
//
// Folders are backed by a single reserved Prism category key. Each
// folder is a category VALUE; nesting uses dot-delimited paths
// (e.g. "Production.Linux.Web"). Validation matches the reference
// impl byte-for-byte so paths created by either tool interoperate.
const FOLDER_CATEGORY_KEY = "NTNXFolderPath";
const FOLDER_MAX_PATH_LEN = 64;
const FOLDER_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_ -]{0,62}[A-Za-z0-9]$|^[A-Za-z0-9]$/;
const FOLDER_FORBIDDEN_CHARS_RE = /[/,!'"#%() *+:;=?`|[\]^&]/;

function normalizeFolderPath(value) {
  return String(value == null ? "" : value).trim();
}

function validateFolderPath(value) {
  const path = normalizeFolderPath(value);
  if (!path) return { ok: false, error: "Folder path is required." };
  if (path.length > FOLDER_MAX_PATH_LEN) {
    return {
      ok: false,
      error: `Folder path must be ${FOLDER_MAX_PATH_LEN} characters or less.`
    };
  }
  if (FOLDER_FORBIDDEN_CHARS_RE.test(path)) {
    return {
      ok: false,
      error: "Folder path contains characters Prism categories do not allow."
    };
  }
  const segments = path.split(".");
  if (segments.some((s) => !s.trim())) {
    return { ok: false, error: "Folder path cannot contain empty segments." };
  }
  for (const segment of segments) {
    if (!FOLDER_SEGMENT_RE.test(segment)) {
      return { ok: false, error: `Invalid folder segment: ${segment}` };
    }
  }
  return { ok: true, value: path };
}

function validateFolderName(value) {
  const name = String(value == null ? "" : value).trim();
  if (!name) return { ok: false, error: "Folder name is required." };
  if (name.includes(".")) {
    return {
      ok: false,
      error: "Folder name cannot contain dots; use the parent selector for nesting."
    };
  }
  if (FOLDER_FORBIDDEN_CHARS_RE.test(name)) {
    return {
      ok: false,
      error: "Folder name contains characters Prism categories do not allow."
    };
  }
  if (!FOLDER_SEGMENT_RE.test(name)) {
    return {
      ok: false,
      error: "Folder name must start and end with a letter or number."
    };
  }
  return { ok: true, value: name };
}

function composeFolderPath(parentPath, name) {
  const parent = normalizeFolderPath(parentPath);
  const nameValidation = validateFolderName(name);
  if (!nameValidation.ok) return nameValidation;
  const path = parent ? `${parent}.${nameValidation.value}` : nameValidation.value;
  const pathValidation = validateFolderPath(path);
  if (!pathValidation.ok) return pathValidation;
  return { ok: true, value: pathValidation.value };
}

// Given the ["key:value", ...] array that parseVmList already attaches
// to every VM, return the NTNXFolderPath value (or "" when unset).
function folderPathFromCategories(categories) {
  if (!Array.isArray(categories)) return "";
  const prefix = `${FOLDER_CATEGORY_KEY}:`;
  for (const entry of categories) {
    if (typeof entry !== "string") continue;
    if (entry.startsWith(prefix)) {
      return normalizeFolderPath(entry.slice(prefix.length));
    }
  }
  return "";
}

// True for a folder path that is a descendant of (or equal to) `root`.
// Used by rename / move / delete to walk subtrees.
function folderPathIsAtOrBelow(path, root) {
  const p = normalizeFolderPath(path);
  const r = normalizeFolderPath(root);
  if (!r) return false;
  return p === r || p.startsWith(`${r}.`);
}

// Replace the `from` prefix with `to` on a path that's known to be at
// or below `from`. Caller is responsible for the subtree check.
function rewriteFolderPathPrefix(path, from, to) {
  const p = normalizeFolderPath(path);
  const f = normalizeFolderPath(from);
  const t = normalizeFolderPath(to);
  if (p === f) return t;
  if (p.startsWith(`${f}.`)) {
    const tail = p.slice(f.length); // includes leading dot
    return `${t}${tail}`;
  }
  return p;
}

function _mapControllerEntityToVm(entity) {
  const name =
    entity?.name ||
    entity?.spec?.name ||
    entity?.status?.name ||
    entity?.metadata?.name ||
    "Unnamed CVM";
  const uuid =
    entity?.extId ||
    entity?.id ||
    entity?.uuid ||
    entity?.metadata?.uuid ||
    entity?.status?.resources?.uuid ||
    "";
  if (!uuid) {
    return null;
  }
  return {
    uuid,
    name,
    powerState:
      entity?.status?.resources?.powerState ||
      entity?.status?.powerState ||
      "UNKNOWN",
    isHidden: true,
    isControllerVm: true,
    isFsvm: false,
    categories: []
  };
}

async function fetchControllerVmCandidates(_client) {
  // The vmm-side controller-vm/cvms endpoints are not exposed in this Prism build.
  // CVM discovery uses the clustermgmt CVM endpoint instead (see fetchClusterCvms).
  return { vms: [], probeResults: [] };
}

async function fetchClusterExternalAddress(client, clusterExtId) {
  if (!clusterExtId) return "";
  const versions = ["v4.0", "v4.1", "v4.2"];
  for (const v of versions) {
    const url = `/api/clustermgmt/${v}/config/clusters/${clusterExtId}`;
    try {
      const resp = await client.get(url, { timeout: 7000 });
      const body = resp?.data?.data || resp?.data || {};
      const ip =
        body?.network?.externalAddress?.ipv4?.value ||
        body?.network?.externalAddress?.value ||
        body?.network?.externalIpAddress?.ipv4?.value ||
        body?.network?.externalIpAddress?.value ||
        body?.externalAddress?.ipv4?.value ||
        body?.externalAddress?.value ||
        body?.externalIpAddress?.ipv4?.value ||
        body?.externalIpAddress?.value ||
        "";
      if (typeof ip === "string" && ip.trim()) {
        return ip.trim();
      }
      // Fallback: any field whose key looks like external + IPv4-shaped value.
      let found = "";
      const visit = (node) => {
        if (!node || typeof node !== "object" || found) return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        for (const [k, v] of Object.entries(node)) {
          if (
            typeof v === "string" &&
            /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) &&
            /external/i.test(k)
          ) {
            found = v;
            return;
          }
          if (v && typeof v === "object") visit(v);
        }
      };
      visit(body);
      if (found) return found;
    } catch (_error) {
      // Try next version.
    }
  }
  return "";
}

async function listClusterIds(client) {
  const candidateUrls = [
    "/api/clustermgmt/v4.0/config/clusters?$limit=100",
    "/api/clustermgmt/v4.1/config/clusters?$limit=100",
    "/api/clustermgmt/v4.2/config/clusters?$limit=100",
    "/api/clustermgmt/v4.0/config/clusters",
    "/api/clustermgmt/v4.1/config/clusters",
    "/api/clustermgmt/v4.2/config/clusters"
  ];
  const probeResults = [];
  for (const url of candidateUrls) {
    try {
      const resp = await client.get(url, { timeout: 7000 });
      const entities = parseGenericEntityList(resp);
      probeResults.push({ url, ok: true, count: entities.length });
      const ids = entities
        .map(
          (cluster) =>
            cluster?.extId ||
            cluster?.id ||
            cluster?.uuid ||
            cluster?.metadata?.uuid ||
            ""
        )
        .filter(Boolean);
      if (ids.length) {
        return {
          ids,
          baseVersion: url.match(/v4\.\d/)?.[0] || "v4.0",
          probeResults
        };
      }
    } catch (error) {
      const data = error.response?.data;
      const errMsg =
        typeof data === "string"
          ? data.slice(0, 240)
          : data
            ? JSON.stringify(data).slice(0, 240)
            : error.message || "";
      probeResults.push({
        url,
        ok: false,
        status: error.response?.status || null,
        message: errMsg
      });
    }
  }
  return { ids: [], baseVersion: "v4.0", probeResults };
}

function pickFirstIpAddress(entity) {
  const candidates = [
    typeof entity?.ipAddress === "string" ? entity.ipAddress : null,
    entity?.ipAddress?.ipv4?.value,
    entity?.ipAddress?.value,
    entity?.ipAddress?.address,
    typeof entity?.externalAddress === "string" ? entity.externalAddress : null,
    entity?.externalAddress?.ipv4?.value,
    entity?.externalAddress?.value,
    entity?.controllerVmExternalAddress,
    typeof entity?.internalAddress === "string" ? entity.internalAddress : null,
    entity?.internalAddress?.ipv4?.value,
    entity?.internalAddress?.value,
    entity?.controllerVmInternalAddress,
    entity?.dataIpv4Address?.value,
    entity?.externalIpv4Address?.value,
    entity?.internalIpv4Address?.value,
    entity?.controllerVmExternalIpv4Address?.value,
    entity?.backplaneIpv4Address?.value,
    Array.isArray(entity?.ipAddresses)
      ? entity.ipAddresses[0]?.ipv4?.value
      : null,
    Array.isArray(entity?.ipAddresses) ? entity.ipAddresses[0]?.value : null,
    Array.isArray(entity?.ipAddresses) ? entity.ipAddresses[0] : null,
    Array.isArray(entity?.ipv4Addresses) ? entity.ipv4Addresses[0]?.value : null
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(c.trim())) {
      return c.trim();
    }
  }
  // Last resort: deep search for any IPv4-shaped string under an "ip"-like key.
  let found = "";
  const visit = (node) => {
    if (!node || typeof node !== "object" || found) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (
        typeof v === "string" &&
        /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) &&
        /(ip|address)/i.test(k)
      ) {
        found = v;
        return;
      }
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(entity);
  return found;
}

async function resolveAhvVmUuidByIpOrName(client, cvmIp, cvmName) {
  const wantedIp = (cvmIp || "").trim();
  const wantedName = (cvmName || "").trim().toLowerCase();
  const diagnostics = {
    triedUrls: [],
    totalVmsSeen: 0,
    sampleNames: [],
    sampleIps: []
  };

  const considerCandidate = (uuid, name, ips, source) => {
    if (!uuid) return null;
    if (diagnostics.sampleNames.length < 25) {
      diagnostics.sampleNames.push(`${name || "?"} (${source})`);
      diagnostics.sampleIps.push((ips || [])[0] || "");
    }
    if (wantedIp && (ips || []).some((ip) => ip === wantedIp)) {
      console.log(
        `[pe-resolve] matched by IP ${wantedIp} -> uuid=${uuid} name=${name} via ${source}`
      );
      return uuid;
    }
    if (wantedName && name && name.toLowerCase() === wantedName) {
      console.log(
        `[pe-resolve] matched by name ${name} -> uuid=${uuid} via ${source}`
      );
      return uuid;
    }
    return null;
  };

  // Strategy 1 (best for PE): v3 groups endpoint with entity_type=vm.
  // Unlike vms/list and v2 PrismGateway/vms (both of which exclude CVMs),
  // groups returns ALL VMs including CVMs. The entity_id is the AHV VM UUID
  // that the legacy /vnc/vm/{uuid}/proxy endpoint accepts.
  try {
    const url = "/api/nutanix/v3/groups";
    const body = {
      entity_type: "vm",
      group_member_count: 500,
      group_member_attributes: [
        { attribute: "vm_name" },
        { attribute: "ip_addresses" },
        { attribute: "controller_vm" }
      ]
    };
    const resp = await client.post(url, body, { timeout: 12000 });
    const rows =
      resp?.data?.group_results?.[0]?.entity_results || [];
    diagnostics.triedUrls.push({
      url,
      ok: true,
      count: rows.length,
      source: "v3-groups"
    });
    diagnostics.totalVmsSeen += rows.length;
    const attrOf = (row, name) => {
      for (const d of row?.data || []) {
        if (d?.name === name) {
          const v = d?.values?.[0]?.values;
          if (Array.isArray(v) && v.length) return v;
        }
      }
      return [];
    };
    for (const row of rows) {
      const uuid = row?.entity_id || "";
      const names = attrOf(row, "vm_name");
      const name = names[0] || "";
      const ips = attrOf(row, "ip_addresses");
      const matched = considerCandidate(uuid, name, ips, "v3-groups");
      if (matched) return { uuid: matched, diagnostics };
    }
  } catch (error) {
    diagnostics.triedUrls.push({
      url: "/api/nutanix/v3/groups",
      ok: false,
      status: error.response?.status || null,
      message:
        (typeof error.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error.response?.data || "")
        ).slice(0, 200) || error.message || "",
      source: "v3-groups"
    });
  }

  // Strategy 2: v4 AHV VMs API (paginated).
  const v4BaseUrls = [
    "/api/vmm/v4.0/ahv/config/vms?$limit=100&$includeHidden=true",
    "/api/vmm/v4.1/ahv/config/vms?$limit=100&$includeHidden=true",
    "/api/vmm/v4.2/ahv/config/vms?$limit=100&$includeHidden=true",
    "/api/vmm/v4.0/ahv/config/vms?$limit=100",
    "/api/vmm/v4.1/ahv/config/vms?$limit=100",
    "/api/vmm/v4.2/ahv/config/vms?$limit=100"
  ];
  for (const baseUrl of v4BaseUrls) {
    let offset = 0;
    let total = 0;
    for (let page = 0; page < 20; page += 1) {
      const url = `${baseUrl}&$page=${offset}`;
      let resp;
      try {
        resp = await client.get(url, { timeout: 8000 });
      } catch (error) {
        diagnostics.triedUrls.push({
          url,
          ok: false,
          status: error.response?.status || null,
          message:
            (typeof error.response?.data === "string"
              ? error.response.data
              : JSON.stringify(error.response?.data || "")
            ).slice(0, 200) || error.message || "",
          source: "v4-vmm"
        });
        break;
      }
      const vms = parseVmList(resp);
      diagnostics.triedUrls.push({
        url,
        ok: true,
        count: vms.length,
        source: "v4-vmm"
      });
      diagnostics.totalVmsSeen += vms.length;
      if (page === 0) {
        const respShape = JSON.stringify(resp.data).slice(0, 240);
        console.log(`[pe-resolve] ${url} status=${resp.status} body=${respShape}`);
      }
      for (const vm of vms) {
        const matched = considerCandidate(
          vm.uuid,
          vm.name,
          vm.ipAddresses,
          "v4-vmm"
        );
        if (matched) return { uuid: matched, diagnostics };
      }
      const pageInfo = extractV4PageInfo(resp);
      if (pageInfo.totalAvailableResults > 0) {
        total = pageInfo.totalAvailableResults;
      }
      if (vms.length < 100 || (total && (offset + 1) * 100 >= total)) {
        break;
      }
      offset += 1;
    }
  }

  // Strategy 2.4: PE hosts endpoint exposes the AHV VM UUID of each node's
  // controller VM directly (controller_vm_id / controller_vm.uuid), and the
  // CVM IP. This is the most reliable source for CVM UUIDs on PE.
  const hostsUrls = [
    "/PrismGateway/services/rest/v2.0/hosts",
    "/PrismGateway/services/rest/v1/hosts",
    "/api/nutanix/v3/hosts/list"
  ];
  for (const hostsUrl of hostsUrls) {
    try {
      const resp =
        hostsUrl.endsWith("/list")
          ? await client.post(
              hostsUrl,
              { kind: "host", length: 100 },
              { timeout: 10000 }
            )
          : await client.get(hostsUrl, { timeout: 10000 });
      const entities =
        resp?.data?.entities ||
        resp?.data?.entityList ||
        resp?.data ||
        [];
      const hostList = Array.isArray(entities) ? entities : [];
      diagnostics.triedUrls.push({
        url: hostsUrl,
        ok: true,
        count: hostList.length,
        source: "pe-hosts"
      });
      if (hostList.length && hostList[0]) {
        const sampleKeys = Object.keys(hostList[0]).join(",");
        console.log(`[pe-hosts] ${hostsUrl} keys: ${sampleKeys}`);
        console.log(
          `[pe-hosts] first host preview: ${JSON.stringify(hostList[0]).slice(0, 600)}`
        );
      }
      for (const host of hostList) {
        // Possible CVM UUID fields:
        const cvmUuid =
          host?.controller_vm_id ||
          host?.controller_vm?.uuid ||
          host?.controllerVmId ||
          host?.controllerVm?.uuid ||
          host?.serviceVMId ||
          host?.service_vm_id ||
          host?.cvm_uuid ||
          host?.controller_vm_backplane_ip ||
          "";
        // Possible CVM IP fields:
        const cvmIpHere =
          host?.controller_vm_external_ip ||
          host?.controller_vm?.external_ip ||
          host?.cvm_external_ip ||
          host?.serviceVMExternalIP ||
          host?.service_vm_external_ip ||
          host?.controllerVmExternalIp ||
          host?.cvmIp ||
          "";
        const cvmHostName =
          host?.name || host?.hypervisor_full_name || host?.hostName || "";
        if (diagnostics.sampleNames.length < 25 && cvmUuid) {
          diagnostics.sampleNames.push(
            `host=${cvmHostName} cvmIp=${cvmIpHere} cvmUuid=${cvmUuid} (pe-hosts)`
          );
        }
        if (cvmUuid && wantedIp && cvmIpHere === wantedIp) {
          console.log(
            `[pe-resolve] matched CVM by host.cvmIp=${wantedIp} -> uuid=${cvmUuid}`
          );
          return { uuid: cvmUuid, diagnostics };
        }
      }
      // Stop after first hosts endpoint that returned data.
      if (hostList.length) break;
    } catch (error) {
      diagnostics.triedUrls.push({
        url: hostsUrl,
        ok: false,
        status: error.response?.status || null,
        message:
          (typeof error.response?.data === "string"
            ? error.response.data
            : JSON.stringify(error.response?.data || "")
          ).slice(0, 200) || error.message || "",
        source: "pe-hosts"
      });
    }
  }

  // Strategy 2.5: PE v2 PrismGateway vms (includes controller VMs by default).
  try {
    const url = "/PrismGateway/services/rest/v2.0/vms?include_vm_nic_config=true";
    const resp = await client.get(url, { timeout: 10000 });
    const entities = resp?.data?.entities || [];
    diagnostics.triedUrls.push({
      url,
      ok: true,
      count: entities.length,
      source: "v2-prismgw"
    });
    diagnostics.totalVmsSeen += entities.length;
    for (const entity of entities) {
      const uuid = entity?.uuid || "";
      const name = entity?.name || "";
      const ips = [];
      (entity?.vm_nics || []).forEach((nic) => {
        if (nic?.ip_address) ips.push(nic.ip_address);
        (nic?.ip_addresses || []).forEach((ip) => ips.push(ip));
      });
      const matched = considerCandidate(uuid, name, ips, "v2-prismgw");
      if (matched) return { uuid: matched, diagnostics };
    }
  } catch (error) {
    diagnostics.triedUrls.push({
      url: "/PrismGateway/services/rest/v2.0/vms?include_vm_nic_config=true",
      ok: false,
      status: error.response?.status || null,
      message:
        (typeof error.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error.response?.data || "")
        ).slice(0, 200) || error.message || "",
      source: "v2-prismgw"
    });
  }

  // Strategy 3: v3 vms/list (older PEs).
  let v3Offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const url = "/api/nutanix/v3/vms/list";
    try {
      const resp = await client.post(
        url,
        { kind: "vm", length: 250, offset: v3Offset },
        { timeout: 10000 }
      );
      const entities = resp?.data?.entities || [];
      diagnostics.triedUrls.push({
        url: `${url} (offset=${v3Offset})`,
        ok: true,
        count: entities.length,
        source: "v3-vms"
      });
      diagnostics.totalVmsSeen += entities.length;
      for (const entity of entities) {
        const uuid = entity?.metadata?.uuid || "";
        const name =
          entity?.spec?.name ||
          entity?.status?.name ||
          entity?.metadata?.name ||
          "";
        const nics =
          entity?.status?.resources?.nic_list ||
          entity?.spec?.resources?.nic_list ||
          [];
        const ips = [];
        nics.forEach((nic) => {
          (nic?.ip_endpoint_list || []).forEach((endpoint) => {
            if (endpoint?.ip) ips.push(endpoint.ip);
          });
        });
        const matched = considerCandidate(uuid, name, ips, "v3-vms");
        if (matched) return { uuid: matched, diagnostics };
      }
      const totalMatches = resp?.data?.metadata?.total_matches || 0;
      if (entities.length < 250 || v3Offset + 250 >= totalMatches) {
        break;
      }
      v3Offset += 250;
    } catch (error) {
      diagnostics.triedUrls.push({
        url: `${url} (offset=${v3Offset})`,
        ok: false,
        status: error.response?.status || null,
        message:
          (typeof error.response?.data === "string"
            ? error.response.data
            : JSON.stringify(error.response?.data || "")
          ).slice(0, 200) || error.message || "",
        source: "v3-vms"
      });
      break;
    }
  }

  console.log(
    `[pe-resolve] no match. total seen=${diagnostics.totalVmsSeen} sample=${diagnostics.sampleNames
      .slice(0, 10)
      .join(" | ")}`
  );
  console.log(
    `[pe-resolve] tried URLs:\n${diagnostics.triedUrls
      .map(
        (t) =>
          `  ${t.ok ? "OK" : "ERR"} status=${t.status ?? ""} count=${t.count ?? "-"} src=${t.source ?? ""} ${t.url} ${t.message ? `msg=${t.message}` : ""}`
      )
      .join("\n")}`
  );
  return { uuid: "", diagnostics };
}

function mapCvmEntityToVm(entity, clusterId) {
  const uuid =
    entity?.extId ||
    entity?.id ||
    entity?.uuid ||
    entity?.metadata?.uuid ||
    entity?.nodeUuid ||
    "";
  if (!uuid) {
    return null;
  }
  const ip = pickFirstIpAddress(entity);
  const rawName =
    entity?.name ||
    entity?.controllerVmName ||
    entity?.cvmName ||
    entity?.fqdn ||
    entity?.domainName ||
    entity?.hostName ||
    entity?.hostname ||
    entity?.nodeName ||
    "";
  const fallbackName = ip
    ? `NTNX-CVM ${ip}`
    : `NTNX-CVM ${uuid.slice(0, 8)}`;
  const name = rawName || fallbackName;
  return {
    uuid,
    name,
    powerState:
      entity?.powerState ||
      entity?.state ||
      entity?.status?.powerState ||
      "UNKNOWN",
    isHidden: true,
    isControllerVm: true,
    isFsvm: false,
    categories: [],
    clusterUuid: clusterId,
    ipAddress: ip || undefined
  };
}

async function fetchClusterCvms(client) {
  const {
    ids: clusterIds,
    baseVersion,
    probeResults: clusterListProbe
  } = await listClusterIds(client);
  if (!clusterIds.length) {
    return { vms: [], probeResults: clusterListProbe };
  }

  const found = [];
  const probeResults = [...clusterListProbe];

  for (const clusterId of clusterIds) {
    const url = `/api/clustermgmt/${baseVersion}/config/clusters/${clusterId}/cvms?$limit=100`;
    try {
      const resp = await client.get(url, { timeout: 7000 });
      const entities = parseGenericEntityList(resp);
      probeResults.push({ url, ok: true, count: entities.length });
      if (entities.length && entities[0]) {
        const sampleKeys = Object.keys(entities[0]).join(",");
        const ipPreview = JSON.stringify(entities[0].ipAddress);
        console.log(
          `[cvm-probe] cluster=${clusterId} first entity keys: ${sampleKeys}`
        );
        console.log(
          `[cvm-probe] cluster=${clusterId} first entity name=${entities[0].name} ipAddress=${ipPreview}`
        );
      }
      entities
        .map((entity) => mapCvmEntityToVm(entity, clusterId))
        .filter(Boolean)
        .forEach((vm) => found.push(vm));
    } catch (error) {
      const data = error.response?.data;
      const errMsg =
        typeof data === "string"
          ? data.slice(0, 240)
          : data
            ? JSON.stringify(data).slice(0, 240)
            : error.message || "";
      probeResults.push({
        url,
        ok: false,
        status: error.response?.status || null,
        message: errMsg
      });
      // Skip retry-loop for PC clusters that explicitly reject CVM list (CLU-10006).
      if (typeof errMsg === "string" && errMsg.includes("CLU-10006")) {
        continue;
      }
    }
  }

  return {
    vms: Array.from(new Map(found.map((vm) => [vm.uuid, vm])).values()),
    probeResults
  };
}

function extractV4PageInfo(vmResponse) {
  const payload = vmResponse?.data?.data || vmResponse?.data || {};
  const metadata = payload?.metadata || vmResponse?.data?.metadata || {};
  const totalAvailableResults =
    Number(metadata?.totalAvailableResults) ||
    Number(metadata?.total_matches) ||
    Number(payload?.totalAvailableResults) ||
    Number(payload?.total_matches) ||
    0;
  const returned =
    Number(metadata?.returnedResults) ||
    Number(metadata?.returned_results) ||
    Number(payload?.returnedResults) ||
    Number(payload?.returned_results) ||
    0;
  return { totalAvailableResults, returned };
}

function formatAxiosError(error) {
  const status = error.response?.status || 500;
  const data = error.response?.data;
  const details =
    typeof data === "string"
      ? data
      : data
        ? JSON.stringify(data)
        : error.message;
  return { status, details };
}

function findFirstValueByKeys(input, keys) {
  if (input === null || input === undefined) {
    return undefined;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findFirstValueByKeys(item, keys);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof input !== "object") {
    return undefined;
  }

  // Handle KV-pair style objects: { name: "WsUri", value: "/console/launch/..." }.
  if (
    typeof input.name === "string" &&
    keys.has(input.name) &&
    input.value !== undefined &&
    input.value !== null &&
    input.value !== ""
  ) {
    return input.value;
  }

  for (const [k, v] of Object.entries(input)) {
    if (keys.has(k) && v !== undefined && v !== null && v !== "") {
      return v;
    }
    const found = findFirstValueByKeys(v, keys);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function extractTaskErrorDetails(taskData) {
  if (!taskData || typeof taskData !== "object") {
    return "";
  }
  const messages = [];
  const seen = new Set();

  const visit = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node.message === "string" && node.message.trim()) {
      const code = node.code ? ` [${node.code}]` : "";
      messages.push(`${node.message.trim()}${code}`);
    }
    if (
      typeof node.errorMessage === "string" &&
      node.errorMessage.trim() &&
      !messages.includes(node.errorMessage.trim())
    ) {
      messages.push(node.errorMessage.trim());
    }
    if (
      typeof node.errorDetail === "string" &&
      node.errorDetail.trim() &&
      !messages.includes(node.errorDetail.trim())
    ) {
      messages.push(node.errorDetail.trim());
    }
    Object.values(node).forEach(visit);
  };
  visit(taskData);

  const unique = Array.from(new Set(messages));
  return unique.slice(0, 3).join(" | ");
}

async function startConsoleTokenTask(client, vmUuid) {
  const candidates = [
    `/api/vmm/v4.2/ahv/config/vms/${vmUuid}/$actions/generate-console-token`,
    `/api/vmm/v4.1/ahv/config/vms/${vmUuid}/$actions/generate-console-token`,
    `/api/vmm/v4.0/ahv/config/vms/${vmUuid}/$actions/generate-console-token`,
    `/api/vmm/v4.2/ahv/config/vms/${vmUuid}/$actions/generate-vm-console-token`,
    `/api/vmm/v4.1/ahv/config/vms/${vmUuid}/$actions/generate-vm-console-token`,
    `/api/vmm/v4.0/ahv/config/vms/${vmUuid}/$actions/generate-vm-console-token`
  ];

  // Different PC builds expose different combinations of these URLs. We
  // need to walk the whole list whenever the failure is "endpoint not
  // wired up on this PC", which can surface as:
  //   - 400 + "no api path found"   (older Prism JSON envelope)
  //   - 404 + Apache/Prism "The requested URL was not found ..."
  //   - 404 + "no api path found"
  //   - 405 method not allowed      (URL exists at a different version)
  // Anything else (auth failure, 5xx, etc.) is a real error and bubbles
  // out immediately.
  function isEndpointMissing(error) {
    const status = error.response?.status;
    const raw = error.response?.data ?? error.message ?? "";
    const text = (typeof raw === "string" ? raw : JSON.stringify(raw)).toLowerCase();
    if (status === 404 || status === 405) return true;
    if (status === 400 || status === 501) {
      if (
        text.includes("no api path found") ||
        text.includes("not found on the server") ||
        text.includes("requested url was not found") ||
        text.includes("no such api") ||
        text.includes("unsupported") ||
        text.includes("not implemented")
      ) {
        return true;
      }
    }
    return false;
  }

  let lastError = null;
  let lastUrl = null;
  for (const url of candidates) {
    try {
      // Prism expects a POST with no request body for this action.
      const resp = await client.request({
        method: "post",
        url,
        headers: {
          "Content-Type": undefined
        },
        data: undefined
      });
      return { resp, usedUrl: url };
    } catch (error) {
      lastError = error;
      lastUrl = url;
      if (isEndpointMissing(error)) {
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    const status = lastError.response?.status;
    const raw = lastError.response?.data ?? lastError.message ?? "";
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const augmented = new Error(
      `No generate-console-token endpoint accepted the request. ` +
      `Tried ${candidates.length} URL variant(s); last attempt was ` +
      `${lastUrl} → HTTP ${status ?? "?"} ${text.slice(0, 240)}`
    );
    augmented.response = lastError.response;
    augmented.endpointMissing = true;
    throw augmented;
  }
  throw new Error("No supported console-token endpoint found.");
}

// Look up a single VM through PC's v4 vmm and pull out its cluster ext_id.
// The shape varies a little across PC versions, so try both the canonical
// `cluster.extId` and the legacy `clusterReference.uuid` / `cluster_uuid`.
// Returns "" when the VM can't be found or has no cluster reference.
async function fetchVmClusterExtId(client, vmUuid) {
  const candidates = [
    `/api/vmm/v4.0/ahv/config/vms/${vmUuid}`,
    `/api/vmm/v4.1/ahv/config/vms/${vmUuid}`,
    `/api/vmm/v4.2/ahv/config/vms/${vmUuid}`
  ];
  for (const url of candidates) {
    try {
      const resp = await client.get(url, { timeout: PRISM_HTTP_TIMEOUT_MS });
      const body = resp?.data?.data || resp?.data || {};
      const id =
        body?.cluster?.extId ||
        body?.cluster?.uuid ||
        body?.clusterReference?.uuid ||
        body?.cluster_reference?.uuid ||
        body?.spec?.cluster_reference?.uuid ||
        body?.spec?.clusterReference?.uuid ||
        body?.metadata?.cluster_reference?.uuid ||
        body?.metadata?.clusterReference?.uuid ||
        "";
      if (typeof id === "string" && id.trim()) {
        return id.trim();
      }
    } catch (_error) {
      /* try next */
    }
  }
  return "";
}

function buildVmListUrl(pageSize, offset, variant = "") {
  const base = `/api/vmm/v4.0/ahv/config/vms?$limit=${pageSize}&$page=${offset}`;
  return variant ? `${base}&${variant}` : base;
}

function vmInventoryCacheKey({ pcHost, username, includeHiddenVms, hydrateVmFolders }) {
  return [
    normalizePrismHost(pcHost).toLowerCase(),
    String(username || "").toLowerCase(),
    includeHiddenVms ? "hidden" : "base",
    hydrateVmFolders ? "folders" : "nofolders"
  ].join("|");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactBaseVm(vm) {
  return {
    uuid: vm.uuid,
    name: vm.name,
    powerState: vm.powerState || "UNKNOWN",
    categories: Array.isArray(vm.categories) ? vm.categories : [],
    ipAddresses: [],
    ipAddress: "",
    isHidden: Boolean(vm.isHidden),
    isControllerVm: Boolean(vm.isControllerVm),
    isFsvm: Boolean(vm.isFsvm)
  };
}

function cacheVmInventory(key, payload) {
  vmInventoryCache.set(key, {
    expiresAt: Date.now() + VM_INVENTORY_CACHE_TTL_MS,
    payload: cloneJson(payload)
  });
}

function getCachedVmInventory(key) {
  const hit = vmInventoryCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    vmInventoryCache.delete(key);
    return null;
  }
  return cloneJson(hit.payload);
}

function makeVmInventoryResponse(vms, selectedVariant, opts = {}) {
  return {
    vms,
    count: vms.length,
    hiddenCount: vms.filter((vm) => vm.isHidden || vm.isControllerVm).length,
    cvmCount: vms.filter((vm) => vm.isControllerVm).length,
    fsvmCount: vms.filter((vm) => vm.isFsvm).length,
    listVariant: selectedVariant || "default",
    inventoryStage: opts.inventoryStage || "enriched",
    enrichmentId: opts.enrichmentId || null,
    enrichmentPending: Boolean(opts.enrichmentId),
    fromCache: Boolean(opts.fromCache),
    cvmProbeSummary: opts.cvmProbeSummary || undefined
  };
}

function getVmListVariants(includeHiddenVms) {
  if (!includeHiddenVms) {
    return [""];
  }
  return [
    "$includeHidden=true",
    "$includeSystemVms=true",
    "$includeInternal=true",
    "$includeInternalVms=true",
    "$includeControllerVms=true",
    "$includeControllerVMs=true",
    "$includeCvm=true",
    "$includeCVM=true",
    "includeInternal=true",
    "includeInternalVms=true",
    "includeControllerVms=true",
    "includeControllerVMs=true",
    "includeCvm=true",
    "includeCVM=true",
    "$includeHidden=true&$includeSystemVms=true",
    "$includeHidden=true&$includeControllerVms=true",
    "$includeInternal=true&$includeControllerVms=true",
    ""
  ];
}

async function selectVmListVariant(client, pageSize, includeHiddenVms) {
  const cacheKey = `${client.defaults.baseURL}|${includeHiddenVms ? "hidden" : "default"}`;
  const cachedVariant = vmListVariantCache.get(cacheKey);
  if (cachedVariant !== undefined) {
    const cachedResp = await client.get(buildVmListUrl(pageSize, 0, cachedVariant), {
      timeout: PRISM_HTTP_TIMEOUT_MS
    });
    return { variant: cachedVariant, firstResponse: cachedResp, score: 0 };
  }

  const variants = getVmListVariants(includeHiddenVms);
  const settled = await Promise.allSettled(
    variants.map(async (variant) => {
      const resp = await client.get(buildVmListUrl(pageSize, 0, variant), {
        timeout: PRISM_HTTP_TIMEOUT_MS
      });
      const parsed = parseVmList(resp);
      const hiddenCount = parsed.filter(
        (vm) => vm.isHidden || vm.isControllerVm
      ).length;
      const score = hiddenCount * 1000 + parsed.length;
      return { variant, firstResponse: resp, score };
    })
  );

  let best = null;
  const failureReasons = [];
  for (const item of settled) {
    if (item.status === "fulfilled") {
      if (!best || item.value.score > best.score) {
        best = item.value;
      }
    } else if (item.reason) {
      const reason = item.reason;
      const status = reason.response?.status;
      const data = reason.response?.data;
      const detail =
        typeof data === "string"
          ? data.slice(0, 160)
          : data
            ? JSON.stringify(data).slice(0, 160)
            : reason.message || String(reason);
      failureReasons.push(
        `${reason.config?.url || "?"} -> ${status ?? "no-response"} ${detail}`
      );
    }
  }

  if (!best) {
    const unique = Array.from(new Set(failureReasons)).slice(0, 5);
    const summary = unique.length
      ? `All ${variants.length} VM-list probes failed against ${client.defaults.baseURL}:\n  - ${unique.join(
          "\n  - "
        )}`
      : `All ${variants.length} VM-list probes failed against ${client.defaults.baseURL} with no response.`;
    const err = new Error(summary);
    err.allProbesFailed = true;
    throw err;
  }
  vmListVariantCache.set(cacheKey, best.variant);
  return best;
}

async function fetchCvmFocusedPage(client, pageSize, offset) {
  const filterVariants = [
    "$filter=isControllerVm eq true",
    "$filter=isSystemVm eq true",
    "$filter=contains(name,'CVM')",
    "$filter=contains(name,'NTNX')"
  ];
  const results = [];
  await Promise.allSettled(
    filterVariants.map(async (filter) => {
      const url = `/api/vmm/v4.0/ahv/config/vms?$limit=${pageSize}&$page=${offset}&${filter}`;
      const resp = await client.get(url, { timeout: PRISM_HTTP_TIMEOUT_MS });
      results.push(...parseVmList(resp));
    })
  );
  return Array.from(new Map(results.map((vm) => [vm.uuid, vm])).values());
}

async function enumerateBaseVms(client, includeHiddenVms) {
  const pageSize = VM_INVENTORY_PAGE_SIZE;
  let offset = 0;
  let total = 0;
  const allVms = [];
  const selected = await selectVmListVariant(
    client,
    pageSize,
    includeHiddenVms
  );
  const selectedVariant = selected.variant;

  for (let i = 0; i < 20; i += 1) {
    const vmResp =
      i === 0
        ? selected.firstResponse
        : await client.get(
            buildVmListUrl(pageSize, offset, selectedVariant),
            { timeout: PRISM_HTTP_TIMEOUT_MS }
          );
    const pageVms = parseVmList(vmResp);
    allVms.push(...pageVms);

    const pageInfo = extractV4PageInfo(vmResp);
    if (pageInfo.totalAvailableResults > 0) total = pageInfo.totalAvailableResults;
    else if (!total) total = allVms.length;

    if (pageVms.length < pageSize || allVms.length >= total) break;
    offset += pageSize;
  }

  const deduped = Array.from(
    new Map(allVms.map((vm) => [vm.uuid, vm])).values()
  ).sort((a, b) => a.name.localeCompare(b.name));
  return { vms: deduped, selectedVariant, pageSize };
}

async function enrichVmInventory(client, baseVms, selectedVariant, includeHiddenVms, authContext = {}, hydrateVmFolders = true) {
  let deduped = baseVms.map((vm) => ({ ...vm }));
  let cvmProbeSummary = [];
  if (includeHiddenVms) {
    const controllerProbe = await fetchControllerVmCandidates(client);
    if (controllerProbe.vms.length) {
      controllerProbe.vms.forEach((vm) => {
        if (!deduped.find((existing) => existing.uuid === vm.uuid)) deduped.push(vm);
      });
      deduped.sort((a, b) => a.name.localeCompare(b.name));
    }

    const clusterCvmProbe = await fetchClusterCvms(client);
    const clusterIpCache = new Map();
    const resolveClusterIp = async (clusterExtId) => {
      if (!clusterExtId) return "";
      if (clusterIpCache.has(clusterExtId)) return clusterIpCache.get(clusterExtId);
      const ip = await fetchClusterExternalAddress(client, clusterExtId);
      clusterIpCache.set(clusterExtId, ip);
      return ip;
    };

    if (clusterCvmProbe.vms.length) {
      const byIp = new Map();
      const byName = new Map();
      for (const vm of deduped) {
        (vm.ipAddresses || []).forEach((ip) => {
          if (ip && !byIp.has(ip)) byIp.set(ip, vm);
        });
        if (vm.name) byName.set(vm.name.toLowerCase(), vm);
      }
      const unmatchedCvms = [];
      clusterCvmProbe.vms.forEach((cvm) => {
        let ahvMatch = null;
        if (cvm.ipAddress && byIp.has(cvm.ipAddress)) ahvMatch = byIp.get(cvm.ipAddress);
        if (!ahvMatch && cvm.name) ahvMatch = byName.get(cvm.name.toLowerCase());
        if (ahvMatch) {
          ahvMatch.isControllerVm = true;
          ahvMatch.isHidden = true;
          ahvMatch.clusterUuid = cvm.clusterUuid || ahvMatch.clusterUuid;
          ahvMatch.cvmExtId = cvm.uuid;
          if (cvm.ipAddress && !ahvMatch.ipAddress) ahvMatch.ipAddress = cvm.ipAddress;
          if (cvm.name && !/cvm/i.test(ahvMatch.name)) ahvMatch.name = cvm.name;
          return;
        }
        unmatchedCvms.push(cvm);
      });
      const peLookups = await Promise.all(
        unmatchedCvms.map(async (cvm) => ({
          cvm,
          peHost: await resolveClusterIp(cvm.clusterUuid)
        }))
      );
      peLookups.forEach(({ cvm, peHost }) => {
        deduped.push({
          ...cvm,
          peHost: peHost || undefined,
          cvmIp: cvm.ipAddress,
          cvmName: cvm.name,
          consoleSupported: Boolean(peHost)
        });
      });
      deduped.sort((a, b) => a.name.localeCompare(b.name));
    }

    const cvmCount = deduped.filter((vm) => vm.isControllerVm).length;
    cvmProbeSummary = [
      ...controllerProbe.probeResults,
      ...clusterCvmProbe.probeResults
    ];
    if (cvmCount === 0) {
      console.error("CVM lookup yielded none. Probe summary:", JSON.stringify(cvmProbeSummary));
      const { pcHost, username, password, tlsSkipVerify } = authContext;
      const sessionCookie = username && password
        ? await createPrismSessionCookie(client, username, password)
        : null;
      if (sessionCookie) {
        const cookieClient = createCookieClient(pcHost, sessionCookie, tlsSkipVerify);
        try {
          const cookieResp = await cookieClient.get(
            buildVmListUrl(VM_INVENTORY_PAGE_SIZE, 0, selectedVariant),
            { timeout: 7000 }
          );
          const cookieVms = parseVmList(cookieResp);
          deduped = Array.from(
            new Map([...deduped, ...cookieVms].map((vm) => [vm.uuid, vm])).values()
          ).sort((a, b) => a.name.localeCompare(b.name));
        } catch (_cookieError) {
          // Ignore; diagnostics already included.
        }
      }
    }
  }
  if (hydrateVmFolders) {
    await hydrateVmFolderCategories(client, deduped);
  }
  return makeVmInventoryResponse(deduped, selectedVariant, {
    inventoryStage: "enriched",
    cvmProbeSummary
  });
}

function startVmInventoryEnrichmentJob({ cacheKey, client, baseVms, selectedVariant, includeHiddenVms, authContext, hydrateVmFolders }) {
  const id = crypto.randomUUID();
  const job = { id, status: "pending", createdAt: Date.now(), result: null, error: null };
  vmInventoryEnrichmentJobs.set(id, job);
  enrichVmInventory(client, baseVms, selectedVariant, includeHiddenVms, authContext, hydrateVmFolders)
    .then((result) => {
      job.status = "done";
      job.result = result;
      cacheVmInventory(cacheKey, result);
    })
    .catch((err) => {
      job.status = "error";
      job.error = err?.message || String(err);
      console.error("[vm-inventory] enrichment failed:", job.error);
    });
  const cleanup = setTimeout(() => vmInventoryEnrichmentJobs.delete(id), 2 * 60 * 1000);
  if (cleanup && typeof cleanup.unref === "function") cleanup.unref();
  return id;
}

app.post("/api/vms", async (req, res) => {
  try {
    const { pcHost, username, password, tlsSkipVerify, includeHiddenVms } =
      resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res.status(400).json({
        error:
          "pcHost, username, and password are required (request body or .env fallback)."
      });
    }
    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    const hydrateVmFolders = VM_FOLDERS_ENABLED && req.body?.hydrateVmFolders !== false;
    const cacheKey = vmInventoryCacheKey({ pcHost, username, includeHiddenVms, hydrateVmFolders });
    const cached = getCachedVmInventory(cacheKey);
    if (cached) {
      logIpCoverage(cached.vms || [], cached.listVariant || "default", includeHiddenVms);
      return res.json({ ...cached, fromCache: true });
    }

    const { vms: baseVms, selectedVariant } = await enumerateBaseVms(client, includeHiddenVms);
    const basePayload = makeVmInventoryResponse(
      baseVms.map(compactBaseVm),
      selectedVariant,
      { inventoryStage: "base" }
    );
    const enrichmentId = startVmInventoryEnrichmentJob({
      cacheKey,
      client,
      baseVms,
      selectedVariant,
      includeHiddenVms,
      authContext: { pcHost, username, password, tlsSkipVerify },
      hydrateVmFolders
    });
    return res.json({
      ...basePayload,
      enrichmentId,
      enrichmentPending: true
    });
  } catch (error) {
    if (error?.message === "Invalid Prism host format.") {
      return res.status(400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    console.error("VM list failed:", details);
    return res.status(status).json({
      error: "Failed to list VMs.",
      details
    });
  }
});

app.get("/api/vms/enrichment/:id", (req, res) => {
  const id = String(req.params.id || "");
  const job = vmInventoryEnrichmentJobs.get(id);
  if (!job) {
    return res.status(404).json({ error: "VM inventory enrichment job not found." });
  }
  if (job.status === "pending") {
    return res.json({ status: "pending", inventoryStage: "enriching" });
  }
  if (job.status === "error") {
    return res.status(500).json({
      status: "error",
      error: "VM inventory enrichment failed.",
      details: job.error
    });
  }
  return res.json({
    status: "done",
    inventoryStage: "enriched",
    ...cloneJson(job.result)
  });
});

// Lightweight credential probe used by the login screen so the user
// gets into the app shell within a second or two, instead of waiting
// for the full multi-cluster VM list to come back from /api/vms.
app.post("/api/pc-test", async (req, res) => {
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "pcHost, username, and password are required." });
    }
    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    // A handful of fast probes, tried in parallel: whichever returns
    // first (with auth-acceptance) wins. We bound each at 6 s so a
    // misbehaving endpoint can't drag the whole login down.
    const probeTimeoutMs = 6000;
    const probes = [
      () => client.get("/api/clustermgmt/v4.0/config/clusters?$limit=1", { timeout: probeTimeoutMs }),
      () => client.get("/api/clustermgmt/v4.1/config/clusters?$limit=1", { timeout: probeTimeoutMs }),
      () => client.get("/PrismGateway/services/rest/v2.0/cluster", { timeout: probeTimeoutMs }),
      () =>
        client.post(
          "/api/nutanix/v3/clusters/list",
          { kind: "cluster", length: 1 },
          { timeout: probeTimeoutMs }
        )
    ];
    let sawAuthFailure = false;
    let lastDetail = "";
    const tryProbe = (fn) =>
      fn().then(
        (resp) => ({ ok: true, status: resp.status }),
        (error) => {
          const status = error.response?.status || null;
          if (status === 401) sawAuthFailure = true;
          const data = error.response?.data;
          const text =
            typeof data === "string"
              ? data
              : data
                ? JSON.stringify(data)
                : error.message || "";
          lastDetail = text.slice(0, 200);
          return { ok: false, status, message: lastDetail };
        }
      );

    // Promise.any resolves on the first fulfilled probe whose result is
    // ok. We wrap each probe in an inversion so non-ok results reject,
    // letting Promise.any short-circuit on the first true success.
    const inverted = probes.map((fn) =>
      tryProbe(fn).then((r) => (r.ok ? r : Promise.reject(r)))
    );
    try {
      const winner = await Promise.any(inverted);
      // Stash the authenticated username on the server-side session so
      // the chat WebSocket has a server-trusted identity to bind to,
      // independent of anything the browser claims later. The PC creds
      // themselves still live only in the browser.
      req.nrccSession.currentUser = username;
      req.nrccSession.pcHost = pcHost;
      appendLogForReq(req, { type: "login.success", details: { probeStatus: winner.status } });
      return res.json({ ok: true, status: winner.status });
    } catch (_aggregate) {
      if (sawAuthFailure) {
        appendLog({
          type: "login.rejected",
          username,
          pcHost,
          sessionId: req.nrccSid,
          remoteIp: req.ip,
          details: { reason: "credentials" }
        });
        return res.status(401).json({
          ok: false,
          error: "Prism Central rejected those credentials (401).",
          details: lastDetail || undefined
        });
      }
      appendLog({
        type: "login.unreachable",
        username,
        pcHost,
        sessionId: req.nrccSid,
        remoteIp: req.ip
      });
      return res.status(502).json({
        ok: false,
        error: `Prism Central at ${pcHost} did not respond to any probe.`,
        details: lastDetail || undefined
      });
    }
  } catch (error) {
    if (error?.message === "Invalid Prism host format.") {
      return res.status(400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    res.status(status).json({ ok: false, error: "PC test failed.", details });
  }
});

app.post("/api/pe-test", async (req, res) => {
  let peHost = "";
  try {
    peHost = normalizePrismHost(req.body.peHost || "");
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
  const peUsername = (req.body.peUsername || "").trim();
  const pePassword = req.body.pePassword || "";
  const tlsSkipVerify = Boolean(req.body.tlsSkipVerify);

  if (!peHost || !peUsername || !pePassword) {
    return res
      .status(400)
      .json({ ok: false, error: "peHost, peUsername, pePassword required." });
  }

  const client = createPrismClient(peHost, peUsername, pePassword, tlsSkipVerify);
  const probes = [
    { method: "GET", url: "/api/clustermgmt/v4.0/config/clusters?$limit=1" },
    { method: "GET", url: "/api/clustermgmt/v4.1/config/clusters?$limit=1" },
    { method: "GET", url: "/api/clustermgmt/v4.2/config/clusters?$limit=1" },
    { method: "GET", url: "/PrismGateway/services/rest/v2.0/cluster" },
    {
      method: "POST",
      url: "/api/nutanix/v3/clusters/list",
      body: { kind: "cluster", length: 1 }
    },
    { method: "GET", url: "/PrismGateway/services/rest/v1/cluster" }
  ];

  const trace = [];
  let sawAuthFailure = false;
  for (const probe of probes) {
    try {
      const resp =
        probe.method === "GET"
          ? await client.get(probe.url, { timeout: 7000 })
          : await client.post(probe.url, probe.body || {}, { timeout: 7000 });
      const entities = parseGenericEntityList(resp);
      trace.push({
        url: `${probe.method} ${probe.url}`,
        ok: true,
        status: resp.status,
        count: entities.length
      });
      console.log(
        `[pe-test] OK ${resp.status} ${probe.method} ${probe.url} count=${entities.length}`
      );
      // Cache the validated credentials in the server-side session map.
      // The browser is only told the host was authenticated; the credentials
      // themselves are never returned in the response.
      req.nrccSession.peCreds.set(peHost, { peUsername, pePassword });
      return res.json({
        ok: true,
        peHost,
        clustersSeen: entities.length,
        viaUrl: `${probe.method} ${probe.url}`,
        stored: true,
        trace
      });
    } catch (error) {
      const status = error.response?.status || null;
      const data = error.response?.data;
      const msg =
        (typeof data === "string"
          ? data
          : data
            ? JSON.stringify(data)
            : error.message || ""
        ).slice(0, 200);
      trace.push({
        url: `${probe.method} ${probe.url}`,
        ok: false,
        status,
        message: msg
      });
      console.log(
        `[pe-test] ERR ${status ?? ""} ${probe.method} ${probe.url} :: ${msg}`
      );
      if (status === 401) sawAuthFailure = true;
    }
  }

  const detailLines = trace.map(
    (t) =>
      `  [${t.ok ? "OK" : "ERR"} ${t.status ?? ""}] ${t.url}${
        t.count !== undefined ? ` count=${t.count}` : ""
      }${t.message ? ` :: ${t.message.slice(0, 140)}` : ""}`
  );

  if (sawAuthFailure) {
    return res.status(401).json({
      ok: false,
      error: "PE rejected those credentials (401).",
      peHost,
      details: detailLines.join("\n"),
      trace
    });
  }
  return res.status(502).json({
    ok: false,
    error: `PE at ${peHost} did not respond to any cluster probe.`,
    peHost,
    details: detailLines.join("\n"),
    trace
  });
});

// Look up a VM via PC (clustermgmt) and return the external IP of its
// Prism Element so we can route console traffic through the PE legacy
// VNC proxy when PC's v4 token action is missing. Returns "" when no
// cluster IP can be determined (e.g., the VM is on a single-node PC
// self-cluster, or the VM/cluster lookup itself fails).
async function resolvePePeerForVm(client, vmUuid) {
  try {
    const clusterExtId = await fetchVmClusterExtId(client, vmUuid);
    if (!clusterExtId) return "";
    const ip = await fetchClusterExternalAddress(client, clusterExtId);
    return ip || "";
  } catch (_error) {
    return "";
  }
}

// Build the WebSocket-proxy session for the PE legacy /vnc/vm/{uuid}/proxy
// path and respond with the websocketUrl the client should connect to.
// Used for the original CVM flow and the new "PC has no v4 token action"
// fallback for regular AHV VMs.
async function respondWithPeLegacyProxy({
  req,
  res,
  peHost,
  peUsername,
  pePassword,
  tlsSkipVerify,
  vmUuid
}) {
  const peClient = createPrismClient(peHost, peUsername, pePassword, tlsSkipVerify);
  const sessionCookie = await createPrismLegacySessionCookie(
    peClient,
    peUsername,
    pePassword
  );
  const targetUrl = `wss://${peHost}:9440/vnc/vm/${vmUuid}/proxy`;
  const proxySessionId = crypto.randomUUID();
  wsProxySessions.set(proxySessionId, {
    targetUrl,
    tlsSkipVerify,
    sessionCookie,
    basicAuth: Buffer.from(`${peUsername}:${pePassword}`).toString("base64"),
    createdAtMs: Date.now(),
    logMeta: {
      vmUuid,
      via: `pe-legacy:${peHost}`,
      username: req.nrccSession?.currentUser || null,
      sessionId: req.nrccSid || null,
      pcHost: req.nrccSession?.pcHost || null
    }
  });
  appendLogForReq(req, {
    type: "console.open",
    vmUuid,
    details: { via: `pe-legacy:${peHost}` }
  });
  const wsProtocol = req.protocol === "https" ? "wss" : "ws";
  const websocketUrl = `${wsProtocol}://${req.get("host")}/ws-proxy/${proxySessionId}`;
  return res.json({
    websocketUrl,
    via: `pe-legacy:${peHost}`,
    targetUrl,
    note:
      "Connecting via Prism Element legacy VNC proxy (/vnc/vm/{uuid}/proxy). " +
      "Session cookie obtained from PrismGateway loginActions."
  });
}

app.post("/api/console-token", async (req, res) => {
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    let vmUuid = req.body.vmUuid;
    const peHost = normalizePrismHost(req.body.peHost || "");
    const cvmIp = (req.body.cvmIp || "").trim();
    const cvmName = (req.body.cvmName || "").trim();

    if (!pcHost || !username || !password) {
      return res.status(400).json({
        error:
          "pcHost, username, and password are required (request body or .env fallback)."
      });
    }

    if (!vmUuid && !cvmIp && !cvmName) {
      return res
        .status(400)
        .json({ error: "vmUuid (or cvmIp/cvmName) is required." });
    }

    const apiHost = peHost || pcHost;
    const usingPe = Boolean(peHost);
    let apiUsername = username;
    let apiPassword = password;
    if (usingPe) {
      // PE credentials are only ever read from the server-side session
      // cache. The client cannot pass them inline; it must authenticate
      // them once via /api/pe-test, which stores them under this session.
      const cached = req.nrccSession.peCreds.get(peHost);
      if (!cached) {
        return res.status(401).json({
          error: "PE credentials required.",
          details:
            `Prism Element at ${apiHost} requires its own credentials. ` +
            "Authenticate this PE once via /api/pe-test; NRCC will cache " +
            "the credentials in server memory for this session only.",
          needPeCredentials: true,
          peHost: apiHost
        });
      }
      apiUsername = cached.peUsername;
      apiPassword = cached.pePassword;
    }
    const client = createPrismClient(
      apiHost,
      apiUsername,
      apiPassword,
      tlsSkipVerify
    );

    if (usingPe) {
      const { uuid: resolvedUuid, diagnostics } =
        await resolveAhvVmUuidByIpOrName(client, cvmIp, cvmName);
      if (!resolvedUuid) {
        const sampleNames = (diagnostics.sampleNames || []).slice(0, 10);
        const probeLines = (diagnostics.triedUrls || [])
          .slice(0, 20)
          .map(
            (t) =>
              `[${t.ok ? "OK" : "ERR"} ${t.status ?? ""}] ${t.source ?? ""} ${t.url}${
                t.count !== undefined ? ` count=${t.count}` : ""
              }${t.message ? ` :: ${t.message.slice(0, 140)}` : ""}`
          );
        return res.status(404).json({
          error: "Could not locate the CVM on its Prism Element.",
          details:
            `PE host ${apiHost} did not return an AHV VM with ip='${cvmIp}' or name='${cvmName}'. ` +
            `Saw ${diagnostics.totalVmsSeen} VM(s). Sample names: ${sampleNames.join(", ") || "(none)"}.\n\n` +
            `Probe trace:\n${probeLines.join("\n")}`,
          diagnostics
        });
      }
      vmUuid = resolvedUuid;
    }

    if (!vmUuid) {
      return res.status(400).json({ error: "vmUuid is required." });
    }

    // PE branch: use legacy /vnc/vm/{uuid}/proxy WebSocket since v4 vmm
    // generate-console-token doesn't exist on this PE.
    if (usingPe) {
      return await respondWithPeLegacyProxy({
        req,
        res,
        peHost: apiHost,
        peUsername: apiUsername,
        pePassword: apiPassword,
        tlsSkipVerify,
        vmUuid
      });
    }

    let postResp;
    let usedUrl;
    try {
      ({ resp: postResp, usedUrl } = await startConsoleTokenTask(client, vmUuid));
    } catch (tokenError) {
      // PC has no working generate-console-token action (every URL variant
      // returned a "not implemented" response). Fall back to the same
      // legacy PE proxy path we already use for CVMs: look up which
      // cluster owns this VM, resolve its external IP, and either return
      // needPeCredentials: true so the client can prompt, or — if PE
      // creds were cached earlier — proxy the console through the PE.
      if (!tokenError.endpointMissing) {
        throw tokenError;
      }
      const fallbackPeHost = await resolvePePeerForVm(client, vmUuid);
      if (!fallbackPeHost) {
        return res.status(502).json({
          error:
            "Prism Central does not implement the v4 generate-console-token action, " +
            "and the VM's cluster external IP could not be resolved for a Prism Element fallback.",
          details: tokenError.message
        });
      }
      const cached = req.nrccSession.peCreds.get(fallbackPeHost);
      if (!cached) {
        return res.status(401).json({
          error: "PE credentials required.",
          details:
            `Prism Central at ${pcHost} does not expose generate-console-token; ` +
            `NRCC will route through Prism Element ${fallbackPeHost} instead. ` +
            "Authenticate this PE once via /api/pe-test; NRCC will cache " +
            "the credentials in server memory for this session only.",
          needPeCredentials: true,
          peHost: fallbackPeHost,
          fallbackReason: "pc-v4-token-action-missing"
        });
      }
      return await respondWithPeLegacyProxy({
        req,
        res,
        peHost: fallbackPeHost,
        peUsername: cached.peUsername,
        pePassword: cached.pePassword,
        tlsSkipVerify,
        vmUuid
      });
    }
    const taskUuid =
      postResp.data?.data?.extId ||
      postResp.data?.data?.id ||
      postResp.data?.extId ||
      postResp.data?.id;

    if (!taskUuid) {
      return res.status(502).json({
        error: "Could not parse task UUID from generate-console-token response.",
        response: postResp.data
      });
    }

    const taskUrl = `/api/prism/v4.0/config/tasks/${taskUuid}`;

    let taskData = null;
    for (let i = 0; i < 20; i += 1) {
      const taskResp = await client.get(taskUrl);
      taskData = taskResp.data?.data || taskResp.data;
      const status =
        taskData?.status ||
        taskData?.progressStatus ||
        taskData?.state ||
        "";

      if (String(status).toUpperCase().includes("SUCCEEDED")) {
        break;
      }

      if (String(status).toUpperCase().includes("FAILED")) {
        const taskDetails = extractTaskErrorDetails(taskData);
        return res.status(502).json({
          error: "Generate console token task failed.",
          details: taskDetails || undefined,
          task: taskData
        });
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    const wsKeys = new Set([
      "console_websocket_uri",
      "WsUri",
      "wsUri",
      "websocketUri",
      "webSocketUri",
      "consoleUri"
    ]);
    const tokenKeys = new Set([
      "console_token",
      "VmConsoleToken",
      "vmConsoleToken",
      "consoleToken",
      "token",
      "jwt"
    ]);

    const wsPath = findFirstValueByKeys(taskData, wsKeys);
    const vmConsoleToken = findFirstValueByKeys(taskData, tokenKeys);

    if (!wsPath || !vmConsoleToken) {
      console.error(
        "Console details missing in task payload:",
        JSON.stringify(taskData)
      );
      return res.status(502).json({
        error: "Task completed but console details were not found in payload.",
        task: taskData
      });
    }

    const cleanPath = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
    const targetUrl = `wss://${apiHost}:9440${cleanPath}?VmConsoleToken=${encodeURIComponent(
      vmConsoleToken
    )}`;
    const sessionCookie = await createPrismSessionCookie(
      client,
      apiUsername,
      apiPassword
    );
    const proxySessionId = crypto.randomUUID();
    const viaTag = usingPe ? `pe:${apiHost}` : `pc:${apiHost}`;
    wsProxySessions.set(proxySessionId, {
      targetUrl,
      tlsSkipVerify,
      sessionCookie,
      basicAuth: Buffer.from(`${apiUsername}:${apiPassword}`).toString("base64"),
      createdAtMs: Date.now(),
      logMeta: {
        vmUuid,
        via: viaTag,
        username: req.nrccSession?.currentUser || null,
        sessionId: req.nrccSid || null,
        pcHost: req.nrccSession?.pcHost || null
      }
    });
    appendLogForReq(req, {
      type: "console.open",
      vmUuid,
      details: { via: viaTag, tokenApiPath: usedUrl }
    });
    const wsProtocol = req.protocol === "https" ? "wss" : "ws";
    const websocketUrl = `${wsProtocol}://${req.get("host")}/ws-proxy/${proxySessionId}`;

    res.json({
      websocketUrl,
      vmConsoleToken,
      tokenApiPath: usedUrl,
      via: viaTag,
      note: usingPe
        ? "Token generated against Prism Element (CVM is not visible to PC)."
        : "Browser must already have a valid Prism session cookie for this host."
    });
  } catch (error) {
    if (error?.message === "Invalid Prism host format.") {
      return res.status(400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    console.error("Console token failed:", details);
    res.status(status).json({
      error: "Failed to generate console token.",
      details
    });
  }
});

// ---------------------------------------------------------------------
// Power actions (Power On / Power Off) for AHV VMs managed by Prism
// Central. CVMs are intentionally not supported here — they're managed
// by the cluster's own genesis service and shouldn't be power-cycled
// from a generic console launcher.
// ---------------------------------------------------------------------

async function getVmEntityEtag(client, vmUuid) {
  const candidates = [
    `/api/vmm/v4.0/ahv/config/vms/${vmUuid}`,
    `/api/vmm/v4.1/ahv/config/vms/${vmUuid}`,
    `/api/vmm/v4.2/ahv/config/vms/${vmUuid}`
  ];
  for (const url of candidates) {
    try {
      const resp = await client.get(url);
      // Axios normalizes header names to lowercase, but some Prism
      // responses also expose the entity ETag in the body as a
      // `$reserved`/`metadata` field. Prefer the HTTP ETag header.
      const etag =
        resp.headers?.etag ||
        resp.headers?.ETag ||
        resp.data?.data?.$reserved?.["ETag"] ||
        resp.data?.data?.metadata?.entityVersion ||
        null;
      if (etag) {
        console.log(`[vm-power] got etag from ${url}: ${etag}`);
        return etag;
      }
      // GET worked but no ETag was returned -- try the next API version.
    } catch (_error) {
      /* try next */
    }
  }
  return null;
}

async function postVmAction(client, url, ifMatchEtag) {
  // Mirror the pattern that startConsoleTokenTask uses: no body, no
  // Content-Type. Some Prism builds reject `{}` here with `INTERNAL_ERROR`
  // or `Bad Request` because they don't expect a body for $action POSTs.
  const headers = { "Content-Type": undefined };
  if (ifMatchEtag) headers["If-Match"] = ifMatchEtag;
  return client.request({
    method: "post",
    url,
    headers,
    data: undefined
  });
}

function isEtagRequiredError(status, messageText) {
  // Different Prism builds signal "I need an If-Match header" in
  // wildly different ways:
  //   - HTTP 412 Precondition Failed (textbook)
  //   - HTTP 428 Precondition Required (textbook)
  //   - HTTP 400 with code VMM-30300 / errorGroup VM_ETAG_MISSING / wording
  //     mentioning "If-Match" or "ETag"
  if (status === 412 || status === 428) return true;
  if (status === 400) {
    const t = (messageText || "").toLowerCase();
    if (
      t.includes("vmm-30300") ||
      t.includes("vm_etag_missing") ||
      t.includes("etag_missing") ||
      t.includes("if-match") ||
      t.includes("if_match") ||
      t.includes("missing etag")
    ) {
      return true;
    }
  }
  return false;
}

async function setVmPowerAction(client, vmUuid, action) {
  // action: 'on' | 'off' (force power-off; not graceful shutdown).
  const variants = [
    `/api/vmm/v4.2/ahv/config/vms/${vmUuid}/$actions/power-${action}`,
    `/api/vmm/v4.1/ahv/config/vms/${vmUuid}/$actions/power-${action}`,
    `/api/vmm/v4.0/ahv/config/vms/${vmUuid}/$actions/power-${action}`
  ];
  let etag = null;
  let lastError = null;
  for (const url of variants) {
    try {
      const resp = await postVmAction(client, url, etag);
      return { resp, usedUrl: url };
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      const messageText =
        typeof data === "string"
          ? data
          : data
            ? JSON.stringify(data)
            : error.message || "";
      console.warn(
        `[vm-power] ${action} attempt ${url} -> ${status ?? "?"} ${messageText.slice(0, 200)}`
      );
      // Endpoint not present on this PC version: move to next candidate.
      // (Be careful: a 400 that's about a missing ETag is NOT "no api path".)
      if (
        status === 400 &&
        messageText.toLowerCase().includes("no api path") &&
        !isEtagRequiredError(status, messageText)
      ) {
        lastError = error;
        continue;
      }
      // ETag required: fetch the entity ETag and retry the same URL.
      if (isEtagRequiredError(status, messageText) && !etag) {
        const fresh = await getVmEntityEtag(client, vmUuid).catch(() => null);
        if (fresh) {
          etag = fresh;
          try {
            const resp2 = await postVmAction(client, url, etag);
            return { resp: resp2, usedUrl: url };
          } catch (retryErr) {
            const retryStatus = retryErr.response?.status;
            const retryData = retryErr.response?.data;
            const retryMsg =
              typeof retryData === "string"
                ? retryData
                : retryData
                  ? JSON.stringify(retryData)
                  : retryErr.message || "";
            console.warn(
              `[vm-power] ${action} retry-with-etag ${url} -> ${retryStatus ?? "?"} ${retryMsg.slice(0, 200)}`
            );
            // If the retry says the endpoint isn't here, fall through to
            // the next variant. Otherwise propagate the error so the
            // user sees the real reason.
            if (
              retryStatus === 400 &&
              retryMsg.toLowerCase().includes("no api path")
            ) {
              lastError = retryErr;
              continue;
            }
            throw retryErr;
          }
        }
        // Couldn't get an ETag at all -- bail out with the original error.
        throw error;
      }
      throw error;
    }
  }
  throw lastError || new Error(`No supported power-${action} endpoint found.`);
}

// =====================================================================
// VM folders -- Prism API helpers (beta feature: vmFolders)
// =====================================================================
//
// All folder operations go through Prism categories under the
// reserved key NTNXFolderPath. Reads come from a v4 categories
// listing with v3 fallback; writes are a v4 POST /config/categories
// (duplicate-as-success) with a v3 PUT fallback. Per-VM membership
// changes prefer the v4 associate-categories action when a category
// extId is available, falling back to a clean v3 metadata PUT.
//
// All of these throw when Prism rejects the call -- the routes below
// translate that into a 4xx/5xx with formatAxiosError() details.

const V4_CATEGORY_LIST_VARIANTS = [
  "/api/prism/v4.1/config/categories",
  "/api/prism/v4.0/config/categories"
];

// Best-effort: list every Prism category value under the folder key.
// Returns Array<{ value, extId? }> -- extId is included when Prism
// surfaces it (v4 only), so /associate-categories can target by id.
async function listFolderCategories(client) {
  // 1) v4 with $filter. Some PC versions reject the $filter syntax;
  //    on any failure we fall back to v4 without the filter and pick
  //    the matching key client-side.
  for (const base of V4_CATEGORY_LIST_VARIANTS) {
    try {
      const out = [];
      let page = 0;
      const limit = 200;
      while (page < 50) {
        const url =
          `${base}?$limit=${limit}&$page=${page}&` +
          `$filter=${encodeURIComponent(`key eq '${FOLDER_CATEGORY_KEY}'`)}`;
        const resp = await client.get(url, { timeout: PRISM_HTTP_TIMEOUT_MS });
        const list = resp.data?.data || resp.data?.entities || [];
        if (!Array.isArray(list) || list.length === 0) break;
        for (const c of list) {
          const key = c?.key || c?.category_key || c?.name;
          const value = c?.value || c?.category_value;
          if (String(key) !== FOLDER_CATEGORY_KEY || !value) continue;
          out.push({ value: normalizeFolderPath(value), extId: c?.extId || c?.id || null });
        }
        if (list.length < limit) break;
        page += 1;
      }
      if (out.length || page > 0) {
        return dedupeFolderCategories(out);
      }
      // Empty result with first page; try the no-filter path.
    } catch (_err) {
      // Filter rejected or endpoint missing — try next variant / no-filter.
    }

    // 1b) v4 without filter — same base — page through and grep key=folder.
    try {
      const out = [];
      let page = 0;
      const limit = 200;
      while (page < 50) {
        const resp = await client.get(
          `${base}?$limit=${limit}&$page=${page}`,
          { timeout: PRISM_HTTP_TIMEOUT_MS }
        );
        const list = resp.data?.data || resp.data?.entities || [];
        if (!Array.isArray(list) || list.length === 0) break;
        for (const c of list) {
          const key = c?.key || c?.category_key || c?.name;
          const value = c?.value || c?.category_value;
          if (String(key) !== FOLDER_CATEGORY_KEY || !value) continue;
          out.push({ value: normalizeFolderPath(value), extId: c?.extId || c?.id || null });
        }
        if (list.length < limit) break;
        page += 1;
      }
      if (out.length || page > 0) {
        return dedupeFolderCategories(out);
      }
    } catch (_err) {
      // Move on to v3.
    }
  }

  // 2) v3 per-key list: PUT /api/nutanix/v3/categories/<key>/list with paging.
  try {
    const out = [];
    let offset = 0;
    const length = 200;
    while (offset < 5000) {
      const resp = await client.post(
        `/api/nutanix/v3/categories/${encodeURIComponent(FOLDER_CATEGORY_KEY)}/list`,
        { kind: "category", offset, length }
      );
      const entities = resp.data?.entities || resp.data?.data || [];
      if (!Array.isArray(entities) || entities.length === 0) break;
      for (const c of entities) {
        const value = c?.value || c?.name;
        if (!value) continue;
        out.push({ value: normalizeFolderPath(value), extId: null });
      }
      if (entities.length < length) break;
      offset += length;
    }
    return dedupeFolderCategories(out);
  } catch (_err) {
    // v3 PUT method on this path; some clusters expect PUT not POST.
    try {
      const resp = await client.put(
        `/api/nutanix/v3/categories/${encodeURIComponent(FOLDER_CATEGORY_KEY)}/list`,
        { kind: "category", offset: 0, length: 500 }
      );
      const entities = resp.data?.entities || resp.data?.data || [];
      const out = [];
      for (const c of (Array.isArray(entities) ? entities : [])) {
        const value = c?.value || c?.name;
        if (!value) continue;
        out.push({ value: normalizeFolderPath(value), extId: null });
      }
      return dedupeFolderCategories(out);
    } catch (_err2) {
      // Nothing else to try; surface the original (most informative) error.
      throw _err;
    }
  }
}

function dedupeFolderCategories(arr) {
  const seen = new Map();
  for (const item of arr) {
    if (!item.value) continue;
    if (!seen.has(item.value)) {
      seen.set(item.value, item);
    } else if (!seen.get(item.value).extId && item.extId) {
      seen.set(item.value, item);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.value.localeCompare(b.value));
}

// Ensure the category value exists in Prism. Duplicate / already-
// exists errors are treated as success (matches the reference impl).
// Returns { extId? } so the caller can use the v4 association path.
async function ensureFolderCategory(client, folderPath) {
  const validation = validateFolderPath(folderPath);
  if (!validation.ok) {
    const e = new Error(validation.error);
    e.userFacing = true;
    e.status = 400;
    throw e;
  }
  const value = validation.value;

  // 1) v4 POST /config/categories
  for (const base of V4_CATEGORY_LIST_VARIANTS) {
    try {
      const resp = await client.post(base, {
        key: FOLDER_CATEGORY_KEY,
        value
      });
      const ext =
        resp.data?.data?.extId ||
        resp.data?.extId ||
        resp.data?.data?.id ||
        resp.data?.id ||
        null;
      return { extId: ext };
    } catch (error) {
      const status = error.response?.status;
      const msg = JSON.stringify(error.response?.data || error.message || "").toLowerCase();
      // 409 / already-exists / duplicate -> success.
      if (status === 409 || msg.includes("already") || msg.includes("duplicate") || msg.includes("exists")) {
        return { extId: null };
      }
      // Not-found endpoint -> try next variant.
      if (status === 404 || msg.includes("no api path")) {
        continue;
      }
      // Fall back to v3 on anything else too -- some clusters reject
      // v4 category creation with 400 for the same content v3 accepts.
      break;
    }
  }

  // 2) v3 fallback: ensure key, then create value.
  try {
    await client.put(
      `/api/nutanix/v3/categories/${encodeURIComponent(FOLDER_CATEGORY_KEY)}`,
      { name: FOLDER_CATEGORY_KEY, description: "NRCC VM folder paths" }
    );
  } catch (_keyErr) {
    // Key may already exist; ignore.
  }
  try {
    await client.put(
      `/api/nutanix/v3/categories/${encodeURIComponent(FOLDER_CATEGORY_KEY)}/${encodeURIComponent(value)}`,
      { value, description: "" }
    );
    return { extId: null };
  } catch (error) {
    const status = error.response?.status;
    const msg = JSON.stringify(error.response?.data || error.message || "").toLowerCase();
    if (status === 409 || msg.includes("already") || msg.includes("duplicate") || msg.includes("exists")) {
      return { extId: null };
    }
    throw error;
  }
}

// Best-effort delete a category value (the leaf folder). Failures
// are swallowed: stale category values are filtered out client-side
// once all VMs in the subtree have been cleared, and there's no
// reliable v3 delete on every PC build. Returns true on success.
async function deleteFolderCategoryValue(client, folderPath) {
  // v4 first.
  for (const base of V4_CATEGORY_LIST_VARIANTS) {
    try {
      // Find the extId for {key=<folder key>, value=<path>}.
      const url =
        `${base}?$limit=10&` +
        `$filter=${encodeURIComponent(
          `key eq '${FOLDER_CATEGORY_KEY}' and value eq '${folderPath}'`
        )}`;
      const resp = await client.get(url, { timeout: PRISM_HTTP_TIMEOUT_MS });
      const list = resp.data?.data || resp.data?.entities || [];
      const match = (Array.isArray(list) ? list : []).find((c) => {
        const key = c?.key || c?.category_key;
        const value = c?.value || c?.category_value;
        return String(key) === FOLDER_CATEGORY_KEY && normalizeFolderPath(value) === folderPath;
      });
      if (match && (match.extId || match.id)) {
        await client.delete(`${base}/${encodeURIComponent(match.extId || match.id)}`);
        return true;
      }
    } catch (_err) { /* try next */ }
  }
  // v3 fallback.
  try {
    await client.delete(
      `/api/nutanix/v3/categories/${encodeURIComponent(FOLDER_CATEGORY_KEY)}/${encodeURIComponent(folderPath)}`
    );
    return true;
  } catch (_err) {
    return false;
  }
}

// Update a single VM's NTNXFolderPath category. `folderPath` of ""
// (or null) clears the folder assignment. Uses v3 metadata PUT
// which is the most-supported path across PC versions and works on
// both AHV VMs and the v3 view of CVMs.
async function setVmFolderPath(client, vmUuid, folderPath) {
  if (!VM_UUID_REGEX.test(String(vmUuid || ""))) {
    const e = new Error("vmUuid is not a valid UUID.");
    e.userFacing = true;
    e.status = 400;
    throw e;
  }
  const target = folderPath ? normalizeFolderPath(folderPath) : "";
  if (target) {
    const v = validateFolderPath(target);
    if (!v.ok) {
      const e = new Error(v.error);
      e.userFacing = true;
      e.status = 400;
      throw e;
    }
  }

  // GET the v3 VM spec, mutate categories, PUT back a clean payload.
  const getResp = await client.get(`/api/nutanix/v3/vms/${vmUuid}`);
  const vm = getResp.data || {};
  const metadata = { ...(vm.metadata || {}) };
  const spec = vm.spec || {};
  const apiVersion = vm.api_version || "3.1";

  // Preserve every other category; only touch NTNXFolderPath.
  const oldMapping = metadata.categories_mapping
    ? { ...metadata.categories_mapping }
    : {};
  const oldDirect = metadata.categories ? { ...metadata.categories } : {};
  if (target) {
    oldMapping[FOLDER_CATEGORY_KEY] = [target];
    oldDirect[FOLDER_CATEGORY_KEY] = target;
  } else {
    delete oldMapping[FOLDER_CATEGORY_KEY];
    delete oldDirect[FOLDER_CATEGORY_KEY];
  }
  metadata.categories_mapping = oldMapping;
  metadata.categories = oldDirect;
  // use_categories_mapping must be true so Prism honours the field.
  metadata.use_categories_mapping = true;

  // Stamp metadata.uuid (required by some PC versions on PUT).
  if (!metadata.uuid) metadata.uuid = vmUuid;

  const payload = {
    api_version: apiVersion,
    metadata,
    spec
  };
  await client.put(`/api/nutanix/v3/vms/${vmUuid}`, payload);
  return { folderPath: target };
}

// Move every VM matching `predicate(vm.folderPath)` to the
// corresponding target via `rewrite(oldPath) -> newPath`. Used by
// folder rename / move / delete. Returns an array describing what
// happened per VM so the caller can log + return progress.
async function moveVmsAcrossFolders(client, predicate, rewrite, includeHidden = true) {
  // Reuse the existing v4 list pathway so we see the full inventory
  // (including hidden / CVM-categorized VMs). Skip page caps in the
  // caller; selectVmListVariant + paging is shared with /api/vms.
  const pageSize = VM_INVENTORY_PAGE_SIZE;
  const selected = await selectVmListVariant(client, pageSize, includeHidden);
  const variant = selected.variant;
  const all = [];
  for (let i = 0; i < 50; i += 1) {
    const resp = i === 0
      ? selected.firstResponse
      : await client.get(buildVmListUrl(pageSize, i * pageSize, variant), { timeout: PRISM_HTTP_TIMEOUT_MS });
    const page = parseVmList(resp);
    all.push(...page);
    const info = extractV4PageInfo(resp);
    if (!info.totalAvailableResults || all.length >= info.totalAvailableResults || page.length < pageSize) break;
  }
  await hydrateVmFolderCategories(client, all);

  const results = [];
  for (const vm of all) {
    const oldPath = folderPathFromCategories(vm.categories);
    if (!predicate(oldPath)) continue;
    const newPath = rewrite(oldPath);
    try {
      await setVmFolderPath(client, vm.uuid, newPath);
      results.push({ vmUuid: vm.uuid, name: vm.name, oldPath, newPath, ok: true });
    } catch (err) {
      const detail = err.response?.data || err.message;
      results.push({
        vmUuid: vm.uuid,
        name: vm.name,
        oldPath,
        newPath,
        ok: false,
        error: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 500)
      });
    }
  }
  return results;
}

function ensureVmFoldersEnabled(req, res) {
  if (!VM_FOLDERS_ENABLED) {
    res.status(503).json({
      error:
        "VM folders are disabled on this NRCC server (NRCC_VM_FOLDERS_ENABLED=false)."
    });
    return false;
  }
  return true;
}

// =====================================================================
// VM folder routes
// =====================================================================

// List every folder Prism currently knows about under NTNXFolderPath.
// Body carries the standard {pcHost,username,password,tlsSkipVerify}
// triple via resolveAuth -- matches /api/vms.
app.post("/api/folders", async (req, res) => {
  if (!ensureVmFoldersEnabled(req, res)) return;
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res.status(400).json({
        error: "pcHost, username, and password are required."
      });
    }
    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    const cats = await listFolderCategories(client);

    // Expand the value set into a folder tree -- every intermediate
    // segment must show up even when no leaf value sits directly at
    // it (e.g. only "Apps.Linux.Web" exists; "Apps" and "Apps.Linux"
    // are still real folders for navigation).
    const all = new Set();
    for (const c of cats) {
      const path = normalizeFolderPath(c.value);
      if (!path) continue;
      const parts = path.split(".");
      for (let i = 1; i <= parts.length; i += 1) {
        all.add(parts.slice(0, i).join("."));
      }
    }
    const folders = Array.from(all)
      .map((p) => {
        const parts = p.split(".");
        return {
          id: p,
          path: p,
          name: parts[parts.length - 1],
          parentPath: parts.length > 1 ? parts.slice(0, -1).join(".") : ""
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    res.json({ categoryKey: FOLDER_CATEGORY_KEY, folders });
  } catch (error) {
    const { status, details } = formatAxiosError(error);
    console.error("[vm-folders] list failed:", details);
    res.status(status).json({
      error: "Failed to list VM folders.",
      details
    });
  }
});

// Create a folder by ensuring the corresponding category value.
// Duplicate-as-success matches the reference impl.
app.post("/api/folders/create", async (req, res) => {
  if (!ensureVmFoldersEnabled(req, res)) return;
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res.status(400).json({ error: "pcHost, username, and password are required." });
    }
    const parentPath = normalizeFolderPath(req.body.parentPath || "");
    const name = String(req.body.name || "").trim();
    const composed = composeFolderPath(parentPath, name);
    if (!composed.ok) return res.status(400).json({ error: composed.error });
    const path = composed.value;

    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    const { extId } = await ensureFolderCategory(client, path);

    appendLogForReq(req, {
      type: "folder.create",
      details: { folderPath: path, parentPath, name }
    });

    res.json({
      ok: true,
      folder: { key: FOLDER_CATEGORY_KEY, value: path, extId }
    });
  } catch (error) {
    if (error.userFacing) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    console.error("[vm-folders] create failed:", details);
    res.status(status).json({ error: "Failed to create folder.", details });
  }
});

// Rename a folder's leaf segment. Walks the entire subtree, ensures
// every rewritten category exists in Prism, then moves every VM
// inside it via setVmFolderPath. Subfolders are implicit -- once the
// VMs are moved, the empty parent categories will be filtered out
// of /api/folders next time it's listed.
app.post("/api/folders/rename", async (req, res) => {
  if (!ensureVmFoldersEnabled(req, res)) return;
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res.status(400).json({ error: "pcHost, username, and password are required." });
    }
    const path = normalizeFolderPath(req.body.path || "");
    const newName = String(req.body.newName || "").trim();
    const pathValidation = validateFolderPath(path);
    if (!pathValidation.ok) return res.status(400).json({ error: pathValidation.error });

    const parts = path.split(".");
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join(".") : "";
    const composed = composeFolderPath(parentPath, newName);
    if (!composed.ok) return res.status(400).json({ error: composed.error });
    const newPath = composed.value;

    if (newPath === path) {
      return res.json({ ok: true, path, newPath, moved: [] });
    }

    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);

    // Ensure the renamed root category up front; per-VM ensure happens
    // implicitly via the v3 metadata PUT.
    await ensureFolderCategory(client, newPath);

    const moved = await moveVmsAcrossFolders(
      client,
      (p) => folderPathIsAtOrBelow(p, path),
      (p) => rewriteFolderPathPrefix(p, path, newPath),
      true
    );

    // Best-effort cleanup of the now-empty old leaf category.
    await deleteFolderCategoryValue(client, path);

    appendLogForReq(req, {
      type: "folder.rename",
      details: {
        oldPath: path,
        newPath,
        vmCount: moved.length,
        succeeded: moved.filter((m) => m.ok).length,
        failed: moved.filter((m) => !m.ok).length
      }
    });

    res.json({ ok: true, path, newPath, moved });
  } catch (error) {
    if (error.userFacing) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    console.error("[vm-folders] rename failed:", details);
    res.status(status).json({ error: "Failed to rename folder.", details });
  }
});

// Move a folder subtree under a new parent.
app.post("/api/folders/move", async (req, res) => {
  if (!ensureVmFoldersEnabled(req, res)) return;
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res.status(400).json({ error: "pcHost, username, and password are required." });
    }
    const path = normalizeFolderPath(req.body.path || "");
    const newParentPath = normalizeFolderPath(req.body.newParentPath || "");
    const pathValidation = validateFolderPath(path);
    if (!pathValidation.ok) return res.status(400).json({ error: pathValidation.error });
    if (newParentPath) {
      const parentValidation = validateFolderPath(newParentPath);
      if (!parentValidation.ok) return res.status(400).json({ error: parentValidation.error });
      if (folderPathIsAtOrBelow(newParentPath, path)) {
        return res.status(400).json({
          error: "Cannot move a folder into itself or one of its descendants."
        });
      }
    }
    const leaf = path.split(".").pop();
    const newPath = newParentPath ? `${newParentPath}.${leaf}` : leaf;
    if (newPath === path) {
      return res.json({ ok: true, path, newPath, moved: [] });
    }
    const newValidation = validateFolderPath(newPath);
    if (!newValidation.ok) return res.status(400).json({ error: newValidation.error });

    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    await ensureFolderCategory(client, newPath);

    const moved = await moveVmsAcrossFolders(
      client,
      (p) => folderPathIsAtOrBelow(p, path),
      (p) => rewriteFolderPathPrefix(p, path, newPath),
      true
    );

    await deleteFolderCategoryValue(client, path);

    appendLogForReq(req, {
      type: "folder.move",
      details: {
        oldPath: path,
        newPath,
        newParentPath,
        vmCount: moved.length,
        succeeded: moved.filter((m) => m.ok).length,
        failed: moved.filter((m) => !m.ok).length
      }
    });

    res.json({ ok: true, path, newPath, moved });
  } catch (error) {
    if (error.userFacing) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    console.error("[vm-folders] move failed:", details);
    res.status(status).json({ error: "Failed to move folder.", details });
  }
});

// Delete a folder subtree: clear NTNXFolderPath on every VM at or
// below `path`, then best-effort drop the matching category values.
// VMs themselves are NOT touched beyond losing the folder category.
app.post("/api/folders/delete", async (req, res) => {
  if (!ensureVmFoldersEnabled(req, res)) return;
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res.status(400).json({ error: "pcHost, username, and password are required." });
    }
    const path = normalizeFolderPath(req.body.path || "");
    const pathValidation = validateFolderPath(path);
    if (!pathValidation.ok) return res.status(400).json({ error: pathValidation.error });

    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    const moved = await moveVmsAcrossFolders(
      client,
      (p) => folderPathIsAtOrBelow(p, path),
      () => "",
      true
    );

    // Drop every category value at or below `path`. Pull a fresh
    // list rather than relying on the subtree we computed locally
    // so we also catch empty intermediate categories.
    const cats = await listFolderCategories(client).catch(() => []);
    const targets = cats
      .map((c) => normalizeFolderPath(c.value))
      .filter((p) => folderPathIsAtOrBelow(p, path));
    const dedup = Array.from(new Set([path, ...targets]));
    const deletedCategories = [];
    for (const p of dedup) {
      const ok = await deleteFolderCategoryValue(client, p);
      if (ok) deletedCategories.push(p);
    }

    appendLogForReq(req, {
      type: "folder.delete",
      details: {
        path,
        vmCount: moved.length,
        succeeded: moved.filter((m) => m.ok).length,
        failed: moved.filter((m) => !m.ok).length,
        deletedCategories
      }
    });

    res.json({ ok: true, path, moved, deletedCategories });
  } catch (error) {
    if (error.userFacing) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    console.error("[vm-folders] delete failed:", details);
    res.status(status).json({ error: "Failed to delete folder.", details });
  }
});

// Move a single VM into a folder. Ensures the target category exists
// first so a fresh folder works on the very first drop.
app.post("/api/vms/folder", async (req, res) => {
  if (!ensureVmFoldersEnabled(req, res)) return;
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res.status(400).json({ error: "pcHost, username, and password are required." });
    }
    const vmUuid = String(req.body.vmUuid || "").trim();
    const folderPath = normalizeFolderPath(req.body.folderPath || "");
    if (!VM_UUID_REGEX.test(vmUuid)) {
      return res.status(400).json({ error: "vmUuid is not a valid UUID." });
    }
    if (!folderPath) {
      return res.status(400).json({
        error: "folderPath is required (use /api/vms/folder/clear to uncategorize)."
      });
    }
    const validation = validateFolderPath(folderPath);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    await ensureFolderCategory(client, folderPath);
    const result = await setVmFolderPath(client, vmUuid, folderPath);

    appendLogForReq(req, {
      type: "vm.folder-move",
      vmUuid,
      details: { folderPath }
    });

    res.json({ ok: true, vmUuid, folderPath: result.folderPath });
  } catch (error) {
    if (error.userFacing) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    console.error("[vm-folders] vm move failed:", details);
    res.status(status).json({ error: "Failed to move VM to folder.", details });
  }
});

// Clear a single VM's NTNXFolderPath category.
app.post("/api/vms/folder/clear", async (req, res) => {
  if (!ensureVmFoldersEnabled(req, res)) return;
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res.status(400).json({ error: "pcHost, username, and password are required." });
    }
    const vmUuid = String(req.body.vmUuid || "").trim();
    if (!VM_UUID_REGEX.test(vmUuid)) {
      return res.status(400).json({ error: "vmUuid is not a valid UUID." });
    }
    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    const result = await setVmFolderPath(client, vmUuid, "");

    appendLogForReq(req, {
      type: "vm.folder-clear",
      vmUuid
    });

    res.json({ ok: true, vmUuid, folderPath: result.folderPath });
  } catch (error) {
    if (error.userFacing) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    console.error("[vm-folders] vm clear failed:", details);
    res.status(status).json({ error: "Failed to clear VM folder.", details });
  }
});

app.post("/api/vm-power", async (req, res) => {
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    const vmUuid = (req.body.vmUuid || "").trim();
    const action = String(req.body.action || "").toLowerCase();
    const peHost = normalizePrismHost(req.body.peHost || "");

    if (!pcHost || !username || !password) {
      return res.status(400).json({
        error:
          "pcHost, username, and password are required (request body or .env fallback)."
      });
    }
    if (!vmUuid) {
      return res.status(400).json({ error: "vmUuid is required." });
    }
    if (action !== "on" && action !== "off") {
      return res
        .status(400)
        .json({ error: "action must be 'on' or 'off'." });
    }
    if (peHost) {
      // CVMs are stamped with peHost; refuse to power-cycle them from here.
      return res.status(400).json({
        error: "Power on/off is not available for CVMs through NRCC.",
        details:
          "Controller VMs are managed by the cluster's genesis service. " +
          "Use cluster-level tools (genesis stop / cluster start) instead."
      });
    }

    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    const { resp, usedUrl } = await setVmPowerAction(client, vmUuid, action);

    const taskUuid =
      resp.data?.data?.extId ||
      resp.data?.data?.id ||
      resp.data?.extId ||
      resp.data?.id;

    if (!taskUuid) {
      return res.json({
        ok: true,
        status: "submitted",
        via: usedUrl,
        action
      });
    }

    const taskUrl = `/api/prism/v4.0/config/tasks/${taskUuid}`;
    let taskData = null;
    for (let i = 0; i < 12; i += 1) {
      const taskResp = await client.get(taskUrl);
      taskData = taskResp.data?.data || taskResp.data;
      const taskStatus =
        taskData?.status ||
        taskData?.progressStatus ||
        taskData?.state ||
        "";

      if (String(taskStatus).toUpperCase().includes("SUCCEEDED")) {
        return res.json({
          ok: true,
          status: "succeeded",
          via: usedUrl,
          action,
          task: { uuid: taskUuid, status: taskStatus }
        });
      }
      if (String(taskStatus).toUpperCase().includes("FAILED")) {
        const taskDetails = extractTaskErrorDetails(taskData);
        return res.status(502).json({
          error: `Power-${action} task failed.`,
          details: taskDetails || undefined,
          task: taskData
        });
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    return res.json({
      ok: true,
      status: "pending",
      via: usedUrl,
      action,
      task: { uuid: taskUuid }
    });
  } catch (error) {
    if (error?.message === "Invalid Prism host format.") {
      return res.status(400).json({ error: error.message });
    }
    const { status, details } = formatAxiosError(error);
    console.error("VM power action failed:", details);
    res.status(status).json({
      error: "Failed to change VM power state.",
      details
    });
  }
});

const server = MULTI_USER_MODE
  ? https.createServer(loadOrCreateTlsMaterial(), app)
  : http.createServer(app);
const wsServer = new WebSocketServer({ noServer: true });
// Chat WebSocketServer is only attached when multi-user mode is on; in
// single-user mode it stays null and any /ws-chat upgrade is rejected.
const wsChatServer = MULTI_USER_MODE ? new WebSocketServer({ noServer: true }) : null;
// SSH terminal WebSocketServer. Always created even in single-user mode
// because the SSH feature is per-user, not multi-user; a single-user
// install can still SSH into VMs from the browser.
const wsSshServer = new WebSocketServer({ noServer: true });
// RDP console WebSocketServer (beta: rdpConsole). Bridges the
// browser's guacamole-common-js client to a locally-installed guacd
// daemon. Always created so a feature-flag flip at runtime doesn't
// require a process restart; the upgrade handler short-circuits when
// the env var is off.
const wsRdpServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // The upgrade handler runs before Express middleware, so build a URL
  // with whatever protocol scheme the request actually used.
  const scheme = MULTI_USER_MODE ? "https" : "http";
  const requestUrl = new URL(req.url, `${scheme}://localhost`);

  if (requestUrl.pathname.startsWith("/ws-proxy/")) {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit("connection", ws, req, requestUrl);
    });
    return;
  }

  if (wsChatServer && requestUrl.pathname === "/ws-chat") {
    wsChatServer.handleUpgrade(req, socket, head, (ws) => {
      wsChatServer.emit("connection", ws, req, requestUrl);
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/ws-ssh/")) {
    if (!SSH_ENABLED) { socket.destroy(); return; }
    wsSshServer.handleUpgrade(req, socket, head, (ws) => {
      wsSshServer.emit("connection", ws, req, requestUrl);
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/ws-rdp/")) {
    if (!RDP_ENABLED) { socket.destroy(); return; }
    wsRdpServer.handleUpgrade(req, socket, head, (ws) => {
      wsRdpServer.emit("connection", ws, req, requestUrl);
    });
    return;
  }

  socket.destroy();
});

wsServer.on("connection", (clientSocket, req, requestUrl) => {
  const sessionId = requestUrl.pathname.replace("/ws-proxy/", "");
  const session = wsProxySessions.get(sessionId);
  if (!session) {
    clientSocket.close(1011, "Session not found");
    return;
  }

  if (Date.now() - session.createdAtMs > 10 * 60 * 1000) {
    wsProxySessions.delete(sessionId);
    clientSocket.close(1011, "Session expired");
    return;
  }

  // Snapshot logging metadata up-front -- we delete the
  // wsProxySessions entry as soon as the upstream connects, so the
  // close handler below can no longer pull it from the map.
  const logMeta = session.logMeta || null;
  const connectedAtMs = Date.now();
  let consoleCloseLogged = false;
  const logConsoleClose = (reason) => {
    if (consoleCloseLogged || !logMeta) return;
    consoleCloseLogged = true;
    appendLog({
      type: "console.close",
      vmUuid: logMeta.vmUuid,
      username: logMeta.username,
      sessionId: logMeta.sessionId,
      pcHost: logMeta.pcHost,
      details: {
        via: logMeta.via,
        durationMs: Date.now() - connectedAtMs,
        reason: reason || "closed"
      }
    });
  };

  const headers = {
    "NTNX-Request-Id": crypto.randomUUID(),
    "X-Request-Id": crypto.randomUUID()
  };
  if (session.sessionCookie) {
    headers.Cookie = session.sessionCookie;
  } else {
    headers.Authorization = `Basic ${session.basicAuth}`;
  }

  const upstream = new WebSocket(session.targetUrl, {
    rejectUnauthorized: !session.tlsSkipVerify,
    headers
  });

  const closeBoth = (code = 1000, reason = "closed") => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close(code, reason);
    }
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close(code, reason);
    }
  };

  upstream.on("open", () => {
    wsProxySessions.delete(sessionId);
  });
  upstream.on("message", (data) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(data);
    }
  });
  clientSocket.on("message", (data) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data);
    }
  });

  upstream.on("close", (code, reason) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close(code, reason.toString());
    }
    logConsoleClose(`upstream:${code}`);
  });
  clientSocket.on("close", () => {
    closeBoth();
    logConsoleClose("client-close");
  });

  upstream.on("error", (error) => {
    console.error("Upstream console WS error:", error.message);
    closeBoth(1011, "Upstream error");
    logConsoleClose("upstream-error");
  });
  clientSocket.on("error", () => {
    closeBoth(1011, "Client error");
    logConsoleClose("client-error");
  });
});

// =====================================================================
// SSH terminal WebSocket. Consumes a session id created by
// /api/ssh/start, opens an ssh2.Client.shell() against the cached
// host/credentials, and pipes raw bytes both directions. Text frames
// from the client carry control messages (currently just window
// resize). The session id is single-use: the entry is deleted from
// `sshSessions` the moment the upgrade is accepted, so a captured
// id cannot be replayed.
// =====================================================================
wsSshServer.on("connection", (ws, req, requestUrl) => {
  const sessionId = requestUrl.pathname.replace("/ws-ssh/", "");
  const sess = sshSessions.get(sessionId);
  if (!sess) {
    try { ws.close(1011, "Session not found"); } catch (_e) { /* ignore */ }
    return;
  }
  // Single-use: the credentials only need to live in the map until we
  // hand them to ssh2. This also means a duplicate WS upgrade for the
  // same sessionId is a no-op.
  sshSessions.delete(sessionId);

  // Belt-and-braces re-validate the SSRF guard in case the probe
  // cache expired between /api/ssh/start and the WS upgrade.
  if (!probeKnowsIpForVm(sess.vmUuid, sess.host)) {
    try { ws.close(1011, "Probe cache expired; re-scan and retry"); } catch (_e) { /* ignore */ }
    return;
  }

  const ssh2 = getSsh2();
  if (!ssh2) {
    try { ws.close(1011, "ssh2 module not installed"); } catch (_e) { /* ignore */ }
    return;
  }

  const connectedAtMs = Date.now();
  let consoleCloseLogged = false;
  const logSshClose = (reason) => {
    if (consoleCloseLogged) return;
    consoleCloseLogged = true;
    appendLog({
      type: "ssh.close",
      vmUuid: sess.vmUuid,
      username: sess.owner,
      sessionId: sess.sessionCookie,
      details: {
        host: sess.host,
        port: sess.port,
        sshUser: sess.username,
        durationMs: Date.now() - connectedAtMs,
        reason: reason || "closed"
      }
    });
  };

  const client = new ssh2.Client();
  let stream = null;

  const closeAll = (code, reason) => {
    try { if (stream) stream.end(); } catch (_e) { /* ignore */ }
    try { client.end(); } catch (_e) { /* ignore */ }
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.close(code || 1000, reason || "closed"); } catch (_e) { /* ignore */ }
    }
  };

  // ws.send is a no-op once the socket is closed; wrap to swallow the
  // race where ssh2 emits a final chunk between ws "close" and the
  // stream end firing.
  const safeSend = (chunk) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(chunk, { binary: true }); } catch (_e) { /* ignore */ }
  };

  client.on("ready", () => {
    appendLog({
      type: "ssh.open",
      vmUuid: sess.vmUuid,
      username: sess.owner,
      sessionId: sess.sessionCookie,
      details: { host: sess.host, port: sess.port, sshUser: sess.username }
    });
    client.shell({ term: "xterm-256color", cols: 80, rows: 24 }, (err, sshStream) => {
      if (err) {
        safeSend(Buffer.from(`\r\n[nrcc] shell allocation failed: ${err.message}\r\n`));
        closeAll(1011, "shell-failed");
        logSshClose(`shell-error:${err.message}`);
        return;
      }
      stream = sshStream;
      // Notify the client that the shell is up so the UI can hide its
      // "connecting..." overlay before the first prompt arrives.
      try { ws.send(JSON.stringify({ type: "ready" })); } catch (_e) { /* ignore */ }
      stream.on("data", (chunk) => safeSend(chunk));
      stream.stderr.on("data", (chunk) => safeSend(chunk));
      stream.on("close", () => {
        closeAll(1000, "shell-closed");
        logSshClose("shell-closed");
      });
    });
  });

  client.on("error", (err) => {
    safeSend(Buffer.from(`\r\n[nrcc] ssh error: ${err.message}\r\n`));
    closeAll(1011, "ssh-error");
    logSshClose(`ssh-error:${err.message}`);
  });

  client.on("end", () => { logSshClose("client-end"); });
  client.on("close", () => { closeAll(1000, "client-close"); });

  ws.on("message", (data, isBinary) => {
    // Binary frames go straight through to the shell; text frames are
    // small JSON control messages. The legitimate client only sends
    // resize today, but we leave the shape open for future extensions.
    if (isBinary) {
      if (stream) {
        try { stream.write(data); } catch (_e) { /* ignore */ }
      }
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString("utf8")); } catch (_e) { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "resize" && stream) {
      const cols = Math.max(2, Math.min(500, Number(msg.cols) || 80));
      const rows = Math.max(2, Math.min(500, Number(msg.rows) || 24));
      try { stream.setWindow(rows, cols, 0, 0); } catch (_e) { /* ignore */ }
    } else if (msg.type === "data" && typeof msg.data === "string" && stream) {
      // Allow text-frame keystroke pass-through for clients that
      // can't send binary frames (rare, but xterm.js does send
      // strings via onData which the client encodes as binary).
      try { stream.write(msg.data); } catch (_e) { /* ignore */ }
    }
  });

  ws.on("close", () => {
    closeAll(1000, "ws-closed");
    logSshClose("ws-closed");
  });
  ws.on("error", () => {
    closeAll(1011, "ws-error");
    logSshClose("ws-error");
  });

  const connectOpts = {
    host: sess.host,
    port: sess.port,
    username: sess.username,
    readyTimeout: SSH_READY_TIMEOUT_MS,
    keepaliveInterval: 30_000,
    // v1: accept any host key. README documents this as a known beta
    // limitation. The IP allow-list (RFC1918 + probe cache) is the
    // primary defence.
    hostVerifier: () => true
  };
  if (sess.privateKey) {
    connectOpts.privateKey = sess.privateKey;
    if (sess.passphrase) connectOpts.passphrase = sess.passphrase;
  } else if (sess.password) {
    connectOpts.password = sess.password;
    // Some sshd configs require keyboard-interactive auth even when a
    // password is configured; ssh2's tryKeyboard helper feeds the same
    // password through that flow.
    connectOpts.tryKeyboard = true;
    client.on("keyboard-interactive", (_n, _i, _l, _p, finish) => {
      finish([sess.password]);
    });
  }
  try {
    client.connect(connectOpts);
  } catch (err) {
    safeSend(Buffer.from(`\r\n[nrcc] ssh connect failed: ${err.message}\r\n`));
    closeAll(1011, "connect-error");
    logSshClose(`connect-error:${err.message}`);
  }
});

// =====================================================================
// RDP console WebSocket -> guacd bridge. Consumes a session id created
// by /api/rdp/start, opens TCP to the locally-installed guacd, runs
// the Guacamole protocol handshake using the cached host /
// credentials, and then pipes raw protocol bytes both directions.
// guacamole-common-js in the browser does the rendering.
//
// Guacamole protocol primer:
//   <len>.<value>(,<len>.<value>)*; -- length is in UTF-16 code
//   units, the same number JS gives you for `string.length`.
// =====================================================================

// Build a wire instruction from arbitrary string elements. Numbers
// are coerced to strings; the length prefix counts UTF-16 code units
// to match the protocol spec.
function encodeGuacInstruction(...elements) {
  return elements.map((e) => {
    const s = String(e == null ? "" : e);
    return `${s.length}.${s}`;
  }).join(",") + ";";
}

// Best-effort parser. Returns { args, endIdx } when a complete
// instruction is available starting at `startIdx`; null when more
// data is required; throws on a malformed prefix so the caller can
// abort the handshake instead of looping forever.
function parseGuacInstruction(text, startIdx) {
  const args = [];
  let i = startIdx;
  while (i < text.length) {
    const dotIdx = text.indexOf(".", i);
    if (dotIdx < 0) return null;
    const lenStr = text.slice(i, dotIdx);
    if (!/^\d+$/.test(lenStr)) {
      throw new Error(`malformed guacd length at ${i}: ${JSON.stringify(lenStr)}`);
    }
    const len = parseInt(lenStr, 10);
    const valStart = dotIdx + 1;
    const valEnd = valStart + len;
    if (valEnd >= text.length) return null;
    args.push(text.slice(valStart, valEnd));
    const sep = text[valEnd];
    if (sep === ",") {
      i = valEnd + 1;
    } else if (sep === ";") {
      return { args, endIdx: valEnd + 1 };
    } else {
      throw new Error(`malformed guacd separator at ${valEnd}: ${JSON.stringify(sep)}`);
    }
  }
  return null;
}

// Map of arg-name -> resolved value for the RDP protocol. Anything
// guacd asks for that we don't know is sent as an empty string,
// which guacd treats as "use the protocol default". This is the
// same "fill what we have, blank the rest" pattern used by the
// reference Java tunnel.
function buildRdpConnectValues(sess) {
  return {
    hostname: sess.host,
    port: String(sess.port),
    username: sess.username,
    password: sess.password,
    domain: sess.domain || "",
    width: String(sess.width),
    height: String(sess.height),
    "dpi": String(sess.dpi),
    security: sess.security || "any",
    "ignore-cert": sess.ignoreCert ? "true" : "false",
    "disable-auth": "false",
    "console": "false",
    // Sensible defaults for a browser-rendered session. Audio /
    // printing / drives are off because we don't proxy any of those
    // upstream.
    "color-depth": "32",
    "resize-method": "display-update",
    "enable-wallpaper": "true",
    "enable-theming": "true",
    "enable-font-smoothing": "true",
    "enable-full-window-drag": "false",
    "enable-desktop-composition": "false",
    "enable-menu-animations": "false",
    "disable-bitmap-caching": "false",
    "disable-offscreen-caching": "false",
    "disable-glyph-caching": "false",
    "client-name": "NRCC"
  };
}

wsRdpServer.on("connection", (ws, req, requestUrl) => {
  const sessionId = requestUrl.pathname.replace("/ws-rdp/", "");
  const sess = rdpSessions.get(sessionId);
  if (!sess) {
    try { ws.close(1011, "Session not found"); } catch (_e) { /* ignore */ }
    return;
  }
  rdpSessions.delete(sessionId);

  if (!probeKnowsIpForVm(sess.vmUuid, sess.host)) {
    try { ws.close(1011, "Probe cache expired; re-scan and retry"); } catch (_e) { /* ignore */ }
    return;
  }

  const connectedAtMs = Date.now();
  let consoleCloseLogged = false;
  const logRdpClose = (reason) => {
    if (consoleCloseLogged) return;
    consoleCloseLogged = true;
    appendLog({
      type: "rdp.close",
      vmUuid: sess.vmUuid,
      username: sess.owner,
      sessionId: sess.sessionCookie,
      details: {
        host: sess.host,
        port: sess.port,
        rdpUser: sess.username,
        durationMs: Date.now() - connectedAtMs,
        reason: reason || "closed"
      }
    });
  };

  const tcp = net.connect({ host: GUACD_HOST, port: GUACD_PORT });
  tcp.setNoDelay(true);

  let handshakeDone = false;
  let argNames = null;
  // Decoded text buffer used during the handshake. We switch to raw
  // byte passthrough once we've consumed the args reply; anything
  // straggling in the buffer at that point is forwarded to the WS.
  const { StringDecoder } = require("string_decoder");
  const decoder = new StringDecoder("utf8");
  let textBuf = "";
  // Once handshake finishes we're a byte pump; the WS may have
  // received the open event and queued instructions before the TCP
  // ready, so we flush a small queue.
  const wsQueue = [];

  const closeAll = (code, reason) => {
    try { tcp.destroy(); } catch (_e) { /* ignore */ }
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.close(code || 1000, reason || "closed"); } catch (_e) { /* ignore */ }
    }
  };

  const safeSendWs = (chunk) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(chunk, { binary: false }); } catch (_e) { /* ignore */ }
  };

  // Handshake timeout: if guacd never replies with `args`, abort so
  // the user gets a clear error instead of a hung tab.
  const handshakeTimer = setTimeout(() => {
    if (!handshakeDone) {
      try { ws.send(encodeGuacInstruction("error", "guacd handshake timeout", "519")); } catch (_e) { /* ignore */ }
      closeAll(1011, "handshake-timeout");
      logRdpClose("handshake-timeout");
    }
  }, GUACD_CONNECT_TIMEOUT_MS);

  tcp.on("connect", () => {
    appendLog({
      type: "rdp.open",
      vmUuid: sess.vmUuid,
      username: sess.owner,
      sessionId: sess.sessionCookie,
      details: { host: sess.host, port: sess.port, rdpUser: sess.username }
    });
    try {
      tcp.write(encodeGuacInstruction("select", "rdp"));
    } catch (err) {
      closeAll(1011, "select-write-failed");
      logRdpClose(`select-write-failed:${err.message}`);
    }
  });

  tcp.on("data", (chunk) => {
    if (handshakeDone) {
      // Plain text pump after the handshake. Two things to be careful
      // about here:
      //
      //  1) UTF-8 boundaries: a multi-byte codepoint can be split
      //     across two TCP chunks. StringDecoder buffers the partial
      //     bytes so we never emit a replacement character.
      //
      //  2) **Instruction boundaries**: guacamole-common-js's
      //     WebSocketTunnel.onmessage parses each WS message
      //     INDEPENDENTLY -- it does not buffer partial instructions
      //     across messages. If we forward a TCP chunk that ends
      //     mid-instruction (which is normal: a 200KB `img` blob is
      //     usually fragmented into several TCP chunks), the parser
      //     desyncs, eventually computes a garbage length, hands a
      //     truncated base64 blob to `Image.decode()` (which throws
      //     `InvalidStateError: The source image could not be
      //     decoded`), and on the next message emits the infamous
      //     `RangeError: Invalid array length at Array.push` once
      //     `parseInt` of mid-data returns a wild number. guacd then
      //     sees the keepalive miss and disconnects with "User is
      //     not responding."
      //
      //  So we accumulate text in `textBuf`, walk it with
      //  parseGuacInstruction to find the END of the LAST complete
      //  instruction we have, and only ship that prefix to the
      //  browser. The partial-instruction tail stays in `textBuf`
      //  for the next chunk to complete.
      textBuf += decoder.write(chunk);
      if (!textBuf) return;
      let cursor = 0;
      try {
        while (cursor < textBuf.length) {
          const inst = parseGuacInstruction(textBuf, cursor);
          if (!inst) break; // partial -- wait for more bytes
          cursor = inst.endIdx;
        }
      } catch (err) {
        // A malformed length / separator from guacd is unrecoverable
        // (the framing is now ambiguous); surface it to the client
        // and tear down rather than feeding it junk.
        try { ws.send(encodeGuacInstruction("error", `guacd framing error: ${err.message}`, "519")); } catch (_e) { /* ignore */ }
        closeAll(1011, "guacd-framing-error");
        logRdpClose(`guacd-framing-error:${err.message}`);
        return;
      }
      if (cursor > 0) {
        safeSendWs(textBuf.slice(0, cursor));
        textBuf = textBuf.slice(cursor);
      }
      return;
    }
    textBuf += decoder.write(chunk);
    try {
      while (true) {
        const inst = parseGuacInstruction(textBuf, 0);
        if (!inst) break;
        const op = inst.args[0];
        textBuf = textBuf.slice(inst.endIdx);
        if (op === "args") {
          // First entry after `args` is the protocol VERSION; the
          // rest are parameter names. The Guacamole 1.5 handshake
          // requires the client to echo VERSION back as the FIRST
          // argument of the `connect` instruction (followed by N
          // values matching the N arg names). Older guacd versions
          // (pre-1.5) didn't expect the VERSION echo, but they also
          // never sent a VERSION in `args`, so we mirror what we got:
          // include the version in `connect` only if guacd announced
          // one in `args`.
          const protocolVersion = inst.args[1] || "";
          const looksLikeVersion = /^\d+\.\d+\.\d+/.test(protocolVersion);
          argNames = looksLikeVersion ? inst.args.slice(2) : inst.args.slice(1);
          const values = buildRdpConnectValues(sess);
          // Fill the connect instruction with values matching the
          // arg-name order guacd dictated. Unknown names get an
          // empty string, which guacd treats as "use default".
          const connectArgs = ["connect"];
          if (looksLikeVersion) connectArgs.push(protocolVersion);
          for (const name of argNames) {
            connectArgs.push(values[name] !== undefined ? values[name] : "");
          }
          try {
            // Order matters here: size/audio/video/image/timezone
            // describe our display capabilities, then connect kicks
            // off the protocol session.
            tcp.write(encodeGuacInstruction("size", sess.width, sess.height, sess.dpi));
            tcp.write(encodeGuacInstruction("audio")); // no audio playback
            tcp.write(encodeGuacInstruction("video")); // no video decode
            // Stick to PNG + JPEG. WebP is technically supported by
            // guacd 1.5.x and modern browsers, but some guacd-encoded
            // WebP variants surface as `InvalidStateError: The source
            // image could not be decoded` in Chrome's image decoder,
            // which silently kills the parser and causes guacd to
            // emit "User is not responding" once the keepalive misses.
            tcp.write(encodeGuacInstruction("image", "image/png", "image/jpeg"));
            tcp.write(encodeGuacInstruction("timezone", "UTC"));
            tcp.write(encodeGuacInstruction(...connectArgs));
          } catch (err) {
            closeAll(1011, "handshake-write-failed");
            logRdpClose(`handshake-write-failed:${err.message}`);
            return;
          }
          handshakeDone = true;
          clearTimeout(handshakeTimer);
          // Flush anything the browser sent before we were ready.
          for (const queued of wsQueue) {
            try { tcp.write(queued); } catch (_e) { /* ignore */ }
          }
          wsQueue.length = 0;
          // Drain anything guacd already sent past the args reply,
          // but only the COMPLETE-instruction prefix (same reasoning
          // as the post-handshake pump above; see the long comment
          // there). Any incomplete tail stays in textBuf and gets
          // completed by the next tcp 'data' chunk.
          if (textBuf.length) {
            let flushCursor = 0;
            try {
              while (flushCursor < textBuf.length) {
                const inst = parseGuacInstruction(textBuf, flushCursor);
                if (!inst) break;
                flushCursor = inst.endIdx;
              }
            } catch (_err) { /* malformed -- next data tick will surface it */ }
            if (flushCursor > 0) {
              safeSendWs(textBuf.slice(0, flushCursor));
              textBuf = textBuf.slice(flushCursor);
            }
          }
          return;
        }
        // guacd may emit `error` during handshake (bad protocol,
        // unknown args). Forward to the client so it can show a
        // real message, then close.
        if (op === "error") {
          safeSendWs(encodeGuacInstruction(...inst.args));
          closeAll(1011, "guacd-error");
          logRdpClose(`guacd-error:${inst.args[1] || ""}`);
          return;
        }
        // Anything else pre-handshake is unexpected but not fatal;
        // drop it so we don't loop on a misframed buffer.
      }
    } catch (err) {
      try { ws.send(encodeGuacInstruction("error", `guacd protocol error: ${err.message}`, "519")); } catch (_e) { /* ignore */ }
      closeAll(1011, "guacd-parse-error");
      logRdpClose(`guacd-parse-error:${err.message}`);
    }
  });

  tcp.on("error", (err) => {
    try {
      // 519 == UPSTREAM_NOT_FOUND in Guacamole's status code map.
      // Most common cause is "guacd is not installed/running".
      ws.send(encodeGuacInstruction("error", `guacd unreachable at ${GUACD_HOST}:${GUACD_PORT} (${err.code || err.message})`, "519"));
    } catch (_e) { /* ignore */ }
    closeAll(1011, "guacd-tcp-error");
    logRdpClose(`guacd-tcp-error:${err.message}`);
  });
  tcp.on("close", () => {
    closeAll(1000, "guacd-closed");
    logRdpClose("guacd-closed");
  });

  ws.on("message", (data, isBinary) => {
    // guacamole-common-js sends text frames containing protocol
    // instructions; we forward them straight to guacd. Binary
    // frames aren't part of the protocol but we accept them anyway
    // for robustness.
    const buf = isBinary ? data : Buffer.from(data.toString("utf8"), "utf8");
    if (!handshakeDone) {
      // Buffer until guacd is ready -- guacamole-common-js sometimes
      // sends a `size` resize before our `connect` arrives.
      wsQueue.push(buf);
      return;
    }
    try { tcp.write(buf); } catch (_e) { /* ignore */ }
  });

  ws.on("close", () => {
    closeAll(1000, "ws-closed");
    logRdpClose("ws-closed");
  });
  ws.on("error", () => {
    closeAll(1011, "ws-error");
    logRdpClose("ws-error");
  });
});

// =====================================================================
// Chat WebSocket. Only attached when MULTI_USER_MODE is on. The handler
// uses the existing nrcc_sid HttpOnly cookie to look up the server-side
// session and pull a server-trusted username from session.currentUser
// (set by /api/pc-test on a successful login). Anything the client
// claims about its own identity is ignored.
// =====================================================================
function chatBroadcast(vmUuid, payload) {
  if (!chatStore) return;
  const json = JSON.stringify(payload);
  for (const ws of chatStore.socketsIn(vmUuid)) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(json); } catch (_e) { /* ignore */ }
    }
  }
}

function chatSend(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch (_e) { /* ignore */ }
}

function chatLeaveCurrent(ws, opts = {}) {
  if (!chatStore || !ws.nrccVmUuid) return;
  const vmUuid = ws.nrccVmUuid;
  chatStore.leave(vmUuid, ws);
  ws.nrccVmUuid = null;
  if (!opts.silent) {
    chatBroadcast(vmUuid, {
      type: "system",
      vmUuid,
      text: `${ws.nrccUsername} left`,
      tsMs: Date.now()
    });
  }
  chatBroadcast(vmUuid, { type: "presence", vmUuid, users: chatStore.usersIn(vmUuid) });
}

if (wsChatServer) {
  wsChatServer.on("connection", (ws, req) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies.nrcc_sid;
    const session = sid ? serverSessions.get(sid) : null;
    if (!session || !session.currentUser) {
      try { ws.close(4401, "Not authenticated"); } catch (_e) { /* ignore */ }
      return;
    }
    ws.nrccUsername = String(session.currentUser);
    ws.nrccVmUuid = null;
    ws.isAlive = true;

    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_e) {
        return chatSend(ws, { type: "error", error: "Invalid JSON." });
      }
      if (!msg || typeof msg.type !== "string") {
        return chatSend(ws, { type: "error", error: "Missing message type." });
      }

      if (msg.type === "ping") {
        return chatSend(ws, { type: "pong", tsMs: Date.now() });
      }

      if (msg.type === "join") {
        const next = msg.vmUuid ? String(msg.vmUuid).toLowerCase() : null;
        if (next && !VM_UUID_REGEX.test(next)) {
          return chatSend(ws, { type: "error", error: "Invalid vmUuid." });
        }
        if (ws.nrccVmUuid === next) return; // no-op switch to current channel
        chatLeaveCurrent(ws);
        if (!next) return;

        chatStore.join(next, ws);
        ws.nrccVmUuid = next;
        chatSend(ws, { type: "history", vmUuid: next, messages: chatStore.history(next) });
        chatBroadcast(next, {
          type: "system",
          vmUuid: next,
          text: `${ws.nrccUsername} joined`,
          tsMs: Date.now()
        });
        chatBroadcast(next, { type: "presence", vmUuid: next, users: chatStore.usersIn(next) });
        return;
      }

      if (msg.type === "leave") {
        chatLeaveCurrent(ws);
        return;
      }

      if (msg.type === "msg") {
        const vmUuid = ws.nrccVmUuid;
        if (!vmUuid) {
          return chatSend(ws, { type: "error", error: "Join a channel before posting." });
        }
        const text = typeof msg.text === "string" ? msg.text.trim() : "";
        if (!text) return chatSend(ws, { type: "error", error: "Empty message." });
        if (text.length > 2000) {
          return chatSend(ws, { type: "error", error: "Message too long (max 2000 chars)." });
        }
        const record = {
          id: crypto.randomUUID(),
          vmUuid,
          username: ws.nrccUsername,
          text,
          tsMs: Date.now()
        };
        chatStore.append(vmUuid, record);
        chatBroadcast(vmUuid, { type: "msg", ...record });
        appendLog({
          type: "chat.send",
          vmUuid,
          username: ws.nrccUsername,
          details: { length: text.length }
        });
        return;
      }

      chatSend(ws, { type: "error", error: `Unknown message type: ${msg.type}` });
    });

    const cleanup = () => chatLeaveCurrent(ws);
    ws.on("close", cleanup);
    ws.on("error", cleanup);

    chatSend(ws, { type: "hello", username: ws.nrccUsername });
  });

  // Heartbeat: terminate any chat socket that hasn't responded to a
  // ping in the last 30s. This stops dead-but-not-yet-closed sockets
  // (browser tab suspended, NAT timeout, etc.) from squatting in the
  // presence list forever.
  setInterval(() => {
    for (const ws of wsChatServer.clients) {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch (_e) { /* ignore */ }
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (_e) { /* ignore */ }
    }
  }, 30 * 1000);
}

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of wsProxySessions.entries()) {
    if (now - session.createdAtMs > 10 * 60 * 1000) {
      wsProxySessions.delete(sessionId);
    }
  }
  for (const [sid, session] of serverSessions.entries()) {
    if (now - session.lastSeenAtMs > SESSION_TTL_MS) {
      serverSessions.delete(sid);
    }
  }
}, 60 * 1000);

server.listen(port, () => {
  const scheme = MULTI_USER_MODE ? "https" : "http";
  console.log(`NRCC ${APP_VERSION} running at ${scheme}://localhost:${port}`);
  if (MULTI_USER_MODE) {
    console.log("[mode] multi-user features enabled: HTTPS, per-VM chat, presence");
  }
});
