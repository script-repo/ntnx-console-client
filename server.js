const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");
const express = require("express");
const axios = require("axios");
const { WebSocketServer, WebSocket } = require("ws");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const wsProxySessions = new Map();
const vmListVariantCache = new Map();

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
    currentUser: req.nrccSession.currentUser || null
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
  req.nrccSession.peCreds.clear();
  req.nrccSession.currentUser = null;
  req.nrccSession.pcHost = null;
  res.json({ ok: true });
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
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    // Common shapes: { ipAddress: { value: "1.2.3.4" } } or { ipAddress: "1.2.3.4" }
    // or { value: "1.2.3.4" } inside ipv4Config / secondaryIpAddressList / ipAddresses.
    for (const [key, val] of Object.entries(node)) {
      if (
        typeof val === "string" &&
        /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(val) &&
        /(ip|address)/i.test(key)
      ) {
        out.add(val);
      } else if (val && typeof val === "object") {
        visit(val);
      }
    }
  };
  // Look at the most likely locations first to avoid sweeping unrelated fields.
  const roots = [
    vm?.nics,
    vm?.spec?.resources?.nicList,
    vm?.status?.resources?.nicList,
    vm?.networkConfig,
    vm?.networkInfo
  ];
  roots.forEach(visit);
  // Fallback: scan whole record (cheap for these small objects).
  if (out.size === 0) visit(vm);
  return Array.from(out);
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
      const categoriesRaw =
        vm?.categories ||
        vm?.metadata?.categories ||
        vm?.status?.resources?.categories ||
        vm?.spec?.resources?.categories ||
        vm?.spec?.categories ||
        {};
      let categories = [];
      if (Array.isArray(categoriesRaw)) {
        categories = categoriesRaw.map((item) => String(item));
      } else if (categoriesRaw && typeof categoriesRaw === "object") {
        categories = Object.entries(categoriesRaw).map(
          ([key, value]) => `${key}:${value}`
        );
      }

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

function parseGenericEntityList(response) {
  const list =
    response?.data?.data?.entities ||
    response?.data?.data ||
    response?.data?.entities ||
    response?.data ||
    [];
  return Array.isArray(list) ? list : [];
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
    const pageSize = 100;
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
      const regularPage = parseVmList(vmResp);
      const cvmFocusedPage = includeHiddenVms
        ? await fetchCvmFocusedPage(client, pageSize, offset)
        : [];
      const pageVms = Array.from(
        new Map(
          [...regularPage, ...cvmFocusedPage].map((vm) => [vm.uuid, vm])
        ).values()
      );
      allVms.push(...pageVms);

      const pageInfo = extractV4PageInfo(vmResp);
      if (pageInfo.totalAvailableResults > 0) {
        total = pageInfo.totalAvailableResults;
      } else if (!total) {
        total = allVms.length;
      }

      if (pageVms.length < pageSize || allVms.length >= total) {
        break;
      }
      offset += pageSize;
    }

    let deduped = Array.from(
      new Map(allVms.map((vm) => [vm.uuid, vm])).values()
    ).sort((a, b) => a.name.localeCompare(b.name));
    if (includeHiddenVms) {
      const controllerProbe = await fetchControllerVmCandidates(client);
      const cvmFromControllerEndpoints = controllerProbe.vms;
      if (cvmFromControllerEndpoints.length) {
        cvmFromControllerEndpoints.forEach((vm) => {
          if (!deduped.find((existing) => existing.uuid === vm.uuid)) {
            deduped.push(vm);
          }
        });
        deduped.sort((a, b) => a.name.localeCompare(b.name));
      }

      const clusterCvmProbe = await fetchClusterCvms(client);
      const clusterIpCache = new Map();
      const resolveClusterIp = async (clusterExtId) => {
        if (!clusterExtId) return "";
        if (clusterIpCache.has(clusterExtId)) {
          return clusterIpCache.get(clusterExtId);
        }
        const ip = await fetchClusterExternalAddress(client, clusterExtId);
        clusterIpCache.set(clusterExtId, ip);
        return ip;
      };

      if (clusterCvmProbe.vms.length) {
        // Build IP/name lookup against the AHV VM list so we can re-key each
        // CVM to its AHV VM UUID. The clustermgmt extId is a CVM-domain
        // identifier and is rejected by VMM with VMM-30100.
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
          if (cvm.ipAddress && byIp.has(cvm.ipAddress)) {
            ahvMatch = byIp.get(cvm.ipAddress);
          }
          if (!ahvMatch && cvm.name) {
            ahvMatch = byName.get(cvm.name.toLowerCase());
          }

          if (ahvMatch) {
            ahvMatch.isControllerVm = true;
            ahvMatch.isHidden = true;
            ahvMatch.clusterUuid = cvm.clusterUuid || ahvMatch.clusterUuid;
            ahvMatch.cvmExtId = cvm.uuid;
            if (cvm.ipAddress && !ahvMatch.ipAddress) {
              ahvMatch.ipAddress = cvm.ipAddress;
            }
            if (cvm.name && !/cvm/i.test(ahvMatch.name)) {
              ahvMatch.name = cvm.name;
            }
            return;
          }
          unmatchedCvms.push(cvm);
        });

        // Resolve PE external IP per cluster for unmatched CVMs so the
        // console-token call can be redirected to the cluster's PE.
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
      if (cvmCount === 0) {
        console.error(
          "CVM lookup yielded none. Probe summary:",
          JSON.stringify([
            ...controllerProbe.probeResults,
            ...clusterCvmProbe.probeResults
          ])
        );
      }
      if (cvmCount === 0) {
        // Fallback: list through Prism session-cookie context (can differ from basic auth view).
        const sessionCookie = await createPrismSessionCookie(
          client,
          username,
          password
        );
        if (sessionCookie) {
          const cookieClient = createCookieClient(pcHost, sessionCookie, tlsSkipVerify);
          try {
            const cookieResp = await cookieClient.get(
              buildVmListUrl(pageSize, 0, selectedVariant),
              { timeout: 7000 }
            );
            const cookieVms = parseVmList(cookieResp);
            deduped = Array.from(
              new Map([...deduped, ...cookieVms].map((vm) => [vm.uuid, vm])).values()
            ).sort((a, b) => a.name.localeCompare(b.name));
          } catch (_cookieError) {
            // Ignore; diagnostics already included below.
          }
        }
      }
      return res.json({
        vms: deduped,
        count: deduped.length,
        hiddenCount: deduped.filter((vm) => vm.isHidden || vm.isControllerVm).length,
        cvmCount: deduped.filter((vm) => vm.isControllerVm).length,
        fsvmCount: deduped.filter((vm) => vm.isFsvm).length,
        listVariant: selectedVariant || "default",
        cvmProbeSummary: [
          ...controllerProbe.probeResults,
          ...clusterCvmProbe.probeResults
        ]
      });
    }
    return res.json({
      vms: deduped,
      count: deduped.length,
      hiddenCount: deduped.filter((vm) => vm.isHidden || vm.isControllerVm).length,
      cvmCount: deduped.filter((vm) => vm.isControllerVm).length,
      fsvmCount: deduped.filter((vm) => vm.isFsvm).length,
      listVariant: selectedVariant || "default"
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
      return res.json({ ok: true, status: winner.status });
    } catch (_aggregate) {
      if (sawAuthFailure) {
        return res.status(401).json({
          ok: false,
          error: "Prism Central rejected those credentials (401).",
          details: lastDetail || undefined
        });
      }
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
    createdAtMs: Date.now()
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
    wsProxySessions.set(proxySessionId, {
      targetUrl,
      tlsSkipVerify,
      sessionCookie,
      basicAuth: Buffer.from(`${apiUsername}:${apiPassword}`).toString("base64"),
      createdAtMs: Date.now()
    });
    const wsProtocol = req.protocol === "https" ? "wss" : "ws";
    const websocketUrl = `${wsProtocol}://${req.get("host")}/ws-proxy/${proxySessionId}`;

    res.json({
      websocketUrl,
      vmConsoleToken,
      tokenApiPath: usedUrl,
      via: usingPe ? `pe:${apiHost}` : `pc:${apiHost}`,
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
  });
  clientSocket.on("close", () => closeBoth());

  upstream.on("error", (error) => {
    console.error("Upstream console WS error:", error.message);
    closeBoth(1011, "Upstream error");
  });
  clientSocket.on("error", () => closeBoth(1011, "Client error"));
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
  console.log(`Nutanix console launcher running at ${scheme}://localhost:${port}`);
  if (MULTI_USER_MODE) {
    console.log("[mode] multi-user features enabled: HTTPS, per-VM chat, presence");
  }
});
