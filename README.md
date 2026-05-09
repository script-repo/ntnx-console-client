# Nutanix Remote Console Client (NRCC)

A lightweight, browser-based console launcher for **Nutanix VMs and CVMs** that does not require the Prism Central or Prism Element web UI.

NRCC speaks to Nutanix REST APIs (v4 / v3 / v2 / PrismGateway), discovers VMs across one or more clusters, and brokers a noVNC session to the VM through a small Node.js WebSocket proxy. It is purpose-built for lab and operations workflows where you need quick console access to many VMs (including CVMs) from a single tab.

---

## Highlights

- **Prism-Central-style sign-in.** Centered login card asks for the three things you actually need — Prism Central IP, username, password — and nothing else. After login, the page is clean: just the VM list, your consoles, and a logout button in the top right.
- **Background VM loading.** Logging in immediately discovers VMs across all PC-managed clusters in the background. The UI stays fully navigatable while the list streams in.
- **Favorites that survive the wait.** Previously starred VMs are pre-populated in the favorites pane the moment you log in (from a local snapshot), so you can open them before the full VM list has finished loading.
- **Drag-and-drop favorites with folders.** Organize favorites into named folders and sub-folders. Drag VMs between folders, drag folders into other folders, double-click a folder name to rename. Persisted in `localStorage`.
- **Single tab, many consoles.** Browser-style overlapping tabs keep multiple consoles open. Click a tab to switch; click the **×** to close.
- **Show All overview.** A green **Show All** button on the console action bar takes a live screenshot of every open console and lays them out in a grid. Click any tile to switch to that console; click outside the grid (or press <kbd>Esc</kbd>) to dismiss.
- **Wall of Eyes.** A light-blue **Wall of Eyes** button opens a separate browser window that mirrors every open console at ~20 fps in a tightly packed grid (no gaps; any unused space is charcoal black). Click **Full Screen** to slam the wall onto a second monitor or a video wall — perfect for an at-a-glance NOC view of every VM you're babysitting.
- **One-click console actions.** A vertical action bar to the right of the console keeps **Ctrl+Alt+Del**, **Paste**, **Close All**, **Show All**, and **Wall of Eyes** within thumb-reach without crowding the tabs.
- **Clipboard paste that actually works on AHV.** AHV guests don't ship a clipboard-sync agent, so a generic <kbd>Ctrl</kbd>+<kbd>V</kbd> on the VNC channel pastes whatever the *guest* had on its clipboard — not the host's. NRCC's **Paste** button instead types your clipboard into the focused window one keystroke at a time, wrapping shifted and AltGr characters with the right modifiers so symbols like `&` and `@` arrive as `&` and `@` (not `7` and `2`). It paces the keystrokes just enough that a Linux PTY's line discipline can't drop bytes on bursty input — so the same button works on Windows GUIs, Linux logins, terminal sessions, and BIOS/UEFI screens with no clipboard agent required.
- **Per-tab guest keyboard layout.** A small dropdown under the **Paste** button picks which keyboard layout the guest VM is configured for (US QWERTY, UK QWERTY, French AZERTY, German QWERTZ, Spanish, Italian, Brazilian ABNT2, Swedish/Finnish, US Dvorak, US Colemak). Each console tab remembers its own choice; new tabs inherit your most recently used layout (persisted in `localStorage`). This is how `&` lands as `&` on a French AZERTY guest where the US QWERTY assumption would have pasted `1`.
- **VM filtering.** Search by name / UUID / IP and filter by power state.
- **CVM support.** Discovers Controller VMs through the v4 `clustermgmt` API on Prism Central, then redirects the console request to the cluster's Prism Element using the legacy VNC proxy when v4 console-token is unavailable.
- **Per-PE credentials, server-side only.** Prism Central credentials don't authenticate to Prism Element by default. NRCC prompts once per PE, validates with a real probe, and caches the credentials **in the NRCC server process's memory only** — keyed to an `HttpOnly` session cookie. They are never written to browser `localStorage`, never persisted to disk, and disappear when the NRCC server restarts (or after 8 hours of inactivity).
- **Pure HTTP/WebSocket.** No agent on the cluster, no plug-in, no special browser extensions. Self-signed TLS toggle for lab environments.
- **Per-VM screenshots.** A teal **Screenshot** button captures the active console as a PNG and saves it server-side under `screenshots/<vm-uuid>/<ISO-timestamp>.png`. A **Browse...** button opens a thumbnail grid of every saved screenshot for the active VM with download / delete / refresh actions. Per-VM retention (default 100, configurable via `NRCC_SCREENSHOT_MAX_PER_VM`) prunes the oldest captures automatically.
- **Multi-user deployment (opt-in).** Set `NRCC_MULTI_USER=true` to flip NRCC into a shared HTTPS deployment with a per-VM real-time chat panel and presence list (in-memory ring buffer of the last `NRCC_CHAT_BUFFER` messages per VM, default 200). A self-signed cert is auto-generated into `./certs/` on first start, with the SHA-256 fingerprint logged for pinning. See [Multi-user deployment](#multi-user-deployment) for the trust model and configuration. Default mode is unchanged single-user HTTP.

---

## Architecture

```
┌──────────┐   localhost   ┌──────────────────────┐    HTTPS / WSS    ┌────────────────────┐
│ Browser  │  ws://3000    │    NRCC server       │ ───────────────▶  │  Prism Central     │
│ (noVNC)  │ ◀──────────── │   (Node + Express)   │                   │  10.x.x.x:9440     │
│          │  HTTP /api/*  │                      │ ───────────────▶  │  Prism Element(s)  │
└──────────┘               └──────────────────────┘                   └────────────────────┘
```

NRCC is two pieces:

### 1. Backend (`server.js`)

A Node.js Express app that:

- **Lists VMs** by paginating Prism Central's `/api/vmm/v4.0/ahv/config/vms` (with `$includeHidden=true`), then enriches the result by probing the cluster-management API (`/api/clustermgmt/v4.x/config/clusters/{id}/cvms`) for Controller VMs that PC's standard list doesn't return.
- **Resolves CVMs to AHV VM UUIDs.** Cluster-mgmt returns CVMs in their own identifier space; that ID is rejected by `generate-console-token` (`VMM-30100`). NRCC matches each CVM back to an AHV VM by IP and name on PE — first via Prism Central, then by falling back to PE's `v3 groups` endpoint, which is the only PE endpoint that reliably returns CVMs alongside user VMs.
- **Generates console tokens** by calling `vmm/v4.x/ahv/config/vms/{uuid}/$actions/generate-console-token` and polling the resulting task. Tries multiple version/action variants for compatibility.
- **Falls back to PE legacy VNC proxy** (`/vnc/vm/{uuid}/proxy`) when Prism Element doesn't expose v4 vmm endpoints. Authenticates with PrismGateway form login or HTTP Basic.
- **Brokers the WebSocket.** The browser opens `ws://localhost:3000/ws-proxy/<id>` and the server proxies bytes to/from the upstream `wss://<prism>:9440/...`, attaching authentication headers server-side. This bypasses cross-site cookie / CORS issues.

### 2. Frontend (`public/`)

Vanilla JS + noVNC, no build step:

- `index.html` — Prism-Central-styled markup, including the sign-in overlay, favorites tree, console tabs, the right-hand action bar (**Ctrl+Alt+Del**, **Paste**, **Close All**, **Show All**, **Wall of Eyes**), the **Show All** grid overlay, and the PE credentials modal.
- `app.js` — login / logout flow, background VM loading, filters, favorites tree with drag-and-drop folders, console tab management, per-console actions (Ctrl+Alt+Del plus a clipboard-typing paste implementation that bypasses the missing AHV clipboard agent), PE credential modal, the screenshot-grid overview, and the popup mirror launcher for the Wall of Eyes window.
- `wall.html` — the standalone page loaded into the Wall of Eyes popup window. It runs same-origin to the main page, reaches back through `window.opener.consoleSessions`, and `drawImage`s every open noVNC `<canvas>` into a single full-window canvas at ~20 fps. An auto-fading toolbar exposes **Full Screen** (Fullscreen API) and **Close**.
- noVNC is served at the URL prefix `/vendor/novnc/`, mapped by `server.js` to `node_modules/@novnc/novnc/` (delivered via the npm package `@novnc/novnc`).

### Console flow

```
┌────────────────────────────┐
│ User clicks Open Console   │
└─────────────┬──────────────┘
              ▼
   ┌──────────────────────┐
   │ POST /api/console-   │ — includes vmUuid, optional peHost / cvmIp / cvmName.
   │   token              │   PE creds are NOT in the body; the server reads
   │                      │   them from its in-memory session map (populated
   │                      │   earlier by POST /api/pe-test).
   └──────┬───────────────┘
          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ Server: PE branch?                                           │
   │  yes → resolve AHV UUID via PE (v3 groups, hosts, v2/v3 VMs) │
   │      → use legacy /vnc/vm/{uuid}/proxy (Basic auth)          │
   │  no  → call generate-console-token on PC, poll task,         │
   │        extract WS path + token                               │
   └──────┬───────────────────────────────────────────────────────┘
          ▼
   ┌──────────────────────┐
   │ Returns websocketUrl │ → ws://localhost:3000/ws-proxy/<id>
   └──────┬───────────────┘
          ▼
   ┌──────────────────────────────────────────────┐
   │ Browser opens noVNC → server proxies bytes   │
   │ to wss://<prism>:9440/... with stored auth   │
   └──────────────────────────────────────────────┘
```

---

## Installation

### Prerequisites

- **Node.js 18+** (tested on Node 20 and 22).
- **Network access** from the machine running NRCC to the Prism Central host on port 9440 and, optionally, to each Prism Element on port 9440 (for CVM consoles).
- A **Prism Central account** with `Generate_VM_Console_Token` permission (typically `Cluster Admin` or `Super Admin`).
- A **Prism Element account** if you intend to open CVM consoles. PE has its own user database; PC credentials do not federate.

### Install

```bash
git clone <this-repo>
cd ntnx-console-client
npm install
```

### Configure (optional)

```bash
copy .env.example .env       # Windows
# or: cp .env.example .env   # macOS/Linux
```

`.env` keys (all optional — values entered in the UI take precedence):

| Key                       | Default            | Description                                                                                            |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `PORT`                    | `3000`             | Local HTTP port.                                                                                       |
| `NUTANIX_PC_HOST`         | _empty_            | Default Prism Central IP / hostname.                                                                   |
| `NUTANIX_USERNAME`        | _empty_            | Default PC username.                                                                                   |
| `NUTANIX_PASSWORD`        | _empty_            | Default PC password.                                                                                   |
| `NUTANIX_TLS_SKIP_VERIFY` | `true`             | Accept self-signed Prism certs (lab default).                                                          |
| `NUTANIX_API_TIMEOUT_MS`  | `30000`            | Per-request timeout (ms) for outbound calls to Prism. Increase if VM listing times out against a slow PC. |

### Run

NRCC has one start command (`npm start`) and one feature toggle (`NRCC_MULTI_USER`). The same binary serves both modes; the environment decides which.

#### Single-user mode (default — HTTP on `localhost`)

```bash
npm start
```

Then open <http://localhost:3000>.

#### Multi-user mode (HTTPS, per-VM chat + presence)

Pick whichever shell syntax matches your platform:

```bash
# macOS / Linux (bash, zsh)
NRCC_MULTI_USER=true npm start
```

```powershell
# Windows PowerShell
$env:NRCC_MULTI_USER='true'; npm start
```

```cmd
:: Windows cmd.exe
set NRCC_MULTI_USER=true && npm start
```

Or persist it in `.env` (cross-platform; `dotenv` is loaded at startup):

```env
NRCC_MULTI_USER=true
```

Then `npm start` as usual. Open <https://localhost:3000> (note **https**) and accept the self-signed cert warning the first time. The startup log prints the cert's SHA-256 fingerprint so you can pin / verify it from the browser's "view certificate" pane.

See [Multi-user deployment](#multi-user-deployment) for the optional companion env vars (`NRCC_TLS_*`, `NRCC_CHAT_BUFFER`, `NRCC_SCREENSHOTS_DIR`, `NRCC_SCREENSHOT_MAX_PER_VM`) and the trust-model caveats.

---

## Usage

1. Open <http://localhost:3000>. The Prism-Central-style **Sign in** card appears.
2. Enter your **Prism Central IP**, **username**, and **password**. Tick **Allow self-signed TLS** for lab environments and **Include hidden / system VMs** if you want CVMs in the list. Tick **Remember host and username** if you want NRCC to repopulate those two fields next time (the password is never stored).
3. Click **Sign in**. NRCC validates the credentials by listing VMs; on success the login overlay disappears and the main UI is shown. Your previously starred favorites are visible in the sidebar **immediately** — even before the full VM list finishes loading — so you can open a familiar console right away.
4. The full VM list streams in the background. The whole UI stays interactive during loading.
5. Search by name / IP / UUID, filter by power state, and click the **★** to favorite a VM.
6. Drag favorites between **folders**. Click **+ Folder** to create a top-level folder, click the **+** on a folder header to create a sub-folder, click the folder name to rename, and click **×** to delete it (its contents move up to the parent — your favorited VMs are not lost).
7. **Click a VM** to open its console. The session opens in a new tab.
   - For regular VMs the console opens immediately via PC's v4 token flow.
   - For CVMs, NRCC prompts once for **PE credentials** (per cluster). The credentials are validated with a probe and cached in the NRCC server's memory for the session — never in the browser, never on disk. To wipe them, click **Forget PE credentials** in the top right (or restart the NRCC server).
8. With multiple consoles open, click the green **Show All** button to the right of the tab strip to see a live screenshot of every console at once. Click any tile to jump to that console; click outside the grid (or press <kbd>Esc</kbd>) to close it.
9. For a continuously-updating overview, click the light-blue **Wall of Eyes** button (under **Show All**). NRCC opens a new browser window that mirrors every open console live at ~20 fps in a tightly packed grid. Click **Full Screen** in the wall window's toolbar to push it to a dedicated monitor; charcoal-black fills any unused space.
10. Click **Logout** in the top right when you're done. NRCC wipes the in-memory PC credentials and closes every open console.

### Keyboard shortcuts and console actions

- The right-hand action bar exposes **Ctrl+Alt+Del**, **Paste**, and a **Guest keymap** dropdown for the active tab.
- **Paste** types your clipboard into the focused guest window one keystroke at a time, wraps shifted and AltGr characters in the right modifiers so symbols like `&!@#$%^*()_+{}|:"<>?~` arrive correctly, and paces the keystrokes just enough that a Linux PTY's line discipline can't drop bytes on bursty input. The same button works for Windows GUIs, Linux logins, terminal sessions, and BIOS/UEFI screens with no clipboard-sync agent required.
- The **Guest keymap** dropdown selects the keyboard layout the guest VM is configured for. Supported layouts:
  - **US QWERTY** (`en-us`, the AHV default)
  - **UK QWERTY** (`en-gb`)
  - **French (AZERTY)** (`fr-FR`) — `@`, `#`, `{`, `}`, `[`, `]`, `\`, `|`, `~`, `` ` `` and `^` are reached via AltGr.
  - **German (QWERTZ)** (`de-DE`) — `Y`/`Z` swap, AltGr layer for `@`, `\`, `|`, brackets and `~`.
  - **Spanish** (`es-ES`)
  - **Italian** (`it-IT`)
  - **Brazilian ABNT2** (`pt-BR`)
  - **Swedish / Finnish** (`sv-SE` / `fi-FI`) — Norwegian and Danish are 99 % identical and can use this option for everyday characters; the only differences are the `Ø/Å` and `Æ/Ø` swaps.
  - **US Dvorak**
  - **US Colemak**
- The selector is **per console tab**, so a French VM and an English VM can be open at the same time with independent layouts. New tabs inherit the most recently used selection (persisted in `localStorage` under `ntnxConsoleLastKeymap`).
- The selector matches the **guest's** keyboard layout, not your host workstation's. Your host layout is irrelevant — `navigator.clipboard` returns Unicode regardless of what physical keys you used to copy the text.
- Characters that aren't in the chosen layout's table (random Unicode, emoji, CJK, accented letters reachable only via dead keys) are sent as raw X11 keysyms with no modifier wrapping. Most Linux guests with the right xkb keymap accept these; Windows guests usually don't, in which case those characters are skipped and the status bar reports the count.
- Paste also seeds the VNC clipboard via `clipboardPasteFrom`, so guests that *do* have a clipboard agent can use the host clipboard normally as well.
- <kbd>Esc</kbd> closes the **Show All** grid overlay.
- In the **Wall of Eyes** popup window, <kbd>Esc</kbd> exits browser fullscreen (the standard Fullscreen API behaviour); the toolbar (with **Full Screen** and **Close**) auto-fades after ~2.5 s of mouse-idle while in fullscreen and reappears on any movement.

---

## Use cases

- **Lab and test environments** — quickly bounce between consoles on multiple clusters without juggling Prism browser tabs.
- **Pre-staging VMs** — connect to brand-new VMs before they have any guest agent or RDP/SSH service.
- **Recovering misconfigured network** — a VM whose NIC was misconfigured can still be reached over the AHV console.
- **CVM diagnostics** — open a CVM console to check boot status without first SSH'ing in (useful when an SSH key is rotated or the CVM is hung in early boot).
- **Multi-tenant ops** — a single dev workstation can hold authenticated sessions to several Prism Elements at once.
- **NOC / video-wall view** — drop the **Wall of Eyes** popup onto a second monitor or a TV in fullscreen mode and watch every console you've opened update in real time during a maintenance window or upgrade.

---

## Caveats and limitations

### CVM listing is asymmetrical

Prism Central exposes Controller VMs only via `clustermgmt/v4.x/config/clusters/{cluster}/cvms`, and not via the standard AHV VM list. The CVM `extId` returned there is **not** the AHV VM UUID — passing it to `generate-console-token` returns `VMM-30100 VM not found`. NRCC works around this by:

1. Stamping each CVM with its cluster's external IP (`peHost`).
2. On Connect, resolving the actual AHV VM UUID by querying PE's `v3 groups` endpoint (`entity_type: "vm"`), which is the only PE endpoint that returns CVMs alongside user VMs.

If your PE has the v4 vmm API exposed, NRCC will use the standard `generate-console-token` flow against PE. If not, it falls back to the legacy `/vnc/vm/{uuid}/proxy` WebSocket — the same endpoint Prism Element's own UI uses.

### Prism Central credentials don't authenticate to Prism Element

PC and PE have separate user databases. PC's `admin` is not automatically a PE user. NRCC will prompt for PE credentials the first time you open a CVM on a given PE, validate them with a real probe (`PrismGateway/services/rest/v2.0/cluster`), and cache them in the NRCC server's in-memory session map (keyed to an `HttpOnly` cookie). Use the **Cancel** button in the modal to abort.

### Network reachability

Your browser talks only to NRCC on `localhost:3000`, but **the NRCC server must be able to reach Prism on port 9440**. Most enterprise networks block 9440 between subnets — run NRCC on a host that already has Prism connectivity (e.g., your jump host).

### Wall of Eyes is a same-origin browser popup

The Wall of Eyes window is a regular `window.open("/wall.html", ...)` popup of the main NRCC tab. There is no separate server-side stream; the popup paints by reaching back through `window.opener.consoleSessions` and reading each session's noVNC `<canvas>` directly. That means:

- **Same browser only.** The wall has to live in the same browser profile as the main NRCC tab. You can't, for example, open `wall.html` in a different browser and have it find the consoles — there's no `window.opener` to read from.
- **Don't close the main tab.** If the main NRCC tab is closed, refreshed, or logged out, every open console disconnects and the wall window switches to a "Disconnected" empty state. Reopen the main tab and click **Wall of Eyes** again.
- **Popup blockers.** If your browser blocks the popup, NRCC reports `Couldn't open Wall of Eyes window — your browser may have blocked the popup.` Allow popups for `localhost:3000` (or whatever host you put in front of NRCC) and retry.
- **One wall at a time.** Re-clicking **Wall of Eyes** while a wall is already open just refocuses the existing window — it doesn't spawn a second one.
- **Performance.** The popup repaints at ~20 fps regardless of how many consoles are open. If you stack a wall of 30+ active VMs on a low-end laptop, expect the GPU to pick up the bill.

### TLS

Self-signed Prism certificates are normal in lab environments. The **Allow self-signed TLS** checkbox sets `rejectUnauthorized: false` for outbound HTTPS and WSS calls. **Do not enable this in production** or anywhere a man-in-the-middle is plausible. If you have a properly signed Prism cert, leave it unchecked.

### Credential handling

- **Prism Central credentials** are entered on the sign-in card. After login, the browser holds them in a JavaScript-only session object — never in the DOM `<input>`, never in `localStorage` — and posts them to the NRCC server with each `/api/vms` and `/api/console-token` call. They are not cached server-side. Clicking **Logout** wipes the in-memory copy; reloading the page also clears them and returns you to the sign-in card.
- **Prism Element credentials** are sent exactly once — to `POST /api/pe-test` — when you first open a CVM on that PE. On a successful probe NRCC caches them in **server-side memory only**, keyed to an opaque `HttpOnly`, `SameSite=Strict` session cookie (`nrcc_sid`). After that, every `POST /api/console-token` looks them up by `peHost`; the browser never sees them again, and they are never returned in any API response.
- The cache lives only in the NRCC process. It is wiped on:
  - **Server restart** (`Ctrl-C` / `npm start` again),
  - **8 hours of session inactivity** (rolling),
  - clicking **Forget PE credentials** in the top right (`DELETE /api/pe-creds`).
- To audit what NRCC has cached for your session, `GET /api/pe-creds` returns just the list of PE host names (no usernames, no passwords).
- The `localStorage` keys NRCC uses are non-credential: `ntnxConsoleProfile` (PC host + username, only when "Remember host and username" is checked on the sign-in card) and `ntnxConsoleFavorites` (the favorites tree — folders, ordering, and a non-secret metadata snapshot of each favorited VM so it can be shown immediately on the next login while the live list is still loading).

### No production hardening

NRCC is a workstation tool by default. The shipped HTTP/`localhost:3000` mode does not implement:

- HTTPS termination on the local server.
- Multi-user auth on the NRCC server itself.
- Role enforcement (Prism's own RBAC still applies to whatever creds you provide).
- Audit logging of console sessions.

For shared installations, see [Multi-user deployment](#multi-user-deployment) below — it adds HTTPS, a per-VM chat panel, and per-VM screenshots, but does **not** add an extra auth tier in front of NRCC. Do not expose NRCC's port to networks beyond your workstation without also putting a real authenticating reverse proxy in front of it.

### API version sensitivity

NRCC tries multiple Prism API versions (`v4.0`, `v4.1`, `v4.2`, `v3`, `v2.0`, `v1`) and remembers which combination worked. If your AOS upgrades change which endpoints respond, refresh the VM list to re-detect.

---

## Multi-user deployment

NRCC has a single-binary "multi-user" mode aimed at small operations teams who want to share one NRCC instance over the LAN. It's gated behind one environment variable and is **off by default** — flipping it on changes nothing about how single-user installs behave today.

### Turning it on

Set `NRCC_MULTI_USER=true` (in `.env` or in the launcher's environment) and start NRCC normally:

```bash
# macOS / Linux (bash, zsh)
NRCC_MULTI_USER=true npm start
```

```powershell
# Windows PowerShell
$env:NRCC_MULTI_USER='true'; npm start
```

```cmd
:: Windows cmd.exe
set NRCC_MULTI_USER=true && npm start
```

Or persist `NRCC_MULTI_USER=true` in `.env` and just `npm start`. The default (`NRCC_MULTI_USER` unset or `false`) keeps the original single-user HTTP behaviour byte-for-byte.

On startup you'll see:

```text
[tls] using cert ./certs/cert.pem (auto-generated)
[tls] sha256 fingerprint: 5D:37:EC:6F:85:8C:1F:E4:83:4E:00:95:F3:3B:82:D9:2D:37:9E:66:F9:50:B5:9E:A4:06:94:7D:15:AE:2C:41
Nutanix console launcher running at https://localhost:3000
[mode] multi-user features enabled: HTTPS, per-VM chat, presence
```

What changes from default:

- The listener switches from `http://` to `https://` (the port number is unchanged).
- The browser sees a "VM chat" launcher in the bottom-right corner once a user is signed in.
- The `/ws-chat` WebSocket is reachable; presence and history per VM UUID are tracked in memory.

What does **not** change:

- Single-user mode (`NRCC_MULTI_USER` unset or `false`) is byte-for-byte identical to before this drop. No HTTPS, no chat UI, no `/ws-chat` listener.
- Screenshots are available in **both** modes (see below). They were added at the same time but are not gated on the multi-user toggle.

### TLS

NRCC will use TLS material in this priority order:

1. `NRCC_TLS_CERT` + `NRCC_TLS_KEY` — explicit paths to a cert and key you provide.
2. `cert.pem` + `key.pem` inside `NRCC_TLS_CERT_DIR` (defaults to `./certs/`).
3. **Auto-generate.** A fresh self-signed RSA-2048 cert, valid 825 days, with SANs for `localhost`, the machine's hostname, and every non-loopback IPv4 address visible on the box. The cert is written into `./certs/`; subsequent restarts reuse it.

Browsers will warn the first time they connect to a self-signed instance. The startup log prints the SHA-256 fingerprint of whichever cert is in use so you can pin/verify it from the browser's "view certificate" pane. To force a regenerate, delete `./certs/` and restart.

For anything more public than a trusted internal LAN, supply your own real cert via `NRCC_TLS_CERT`/`NRCC_TLS_KEY` (or, better, terminate TLS at a real reverse proxy and proxy plain HTTP to NRCC over loopback only).

### Per-VM chat

When multi-user mode is on, the bottom-right chat icon opens a slide-out panel scoped to the **currently active console tab**. Each VM UUID gets its own channel — switching tabs joins the new channel, leaving the old one. Joins, leaves, and message history (most recent `NRCC_CHAT_BUFFER` messages, default 200) are sent to clients that join.

Identity for the chat is the PC username from your NRCC login — there is **no extra password** for chat. When a user logs in, NRCC stashes their PC username server-side, keyed to the same `nrcc_sid` cookie used for PE-cred caching. The `/ws-chat` connection picks up that cookie, looks up the username, and binds it to the socket. Anything the client claims about its own identity is ignored. This means:

- **Trust model.** Chat identity is only as strong as the PC login. A user who can write to the JS bundle (or to your reverse proxy) could spoof another username at the WebSocket layer. This matches NRCC's existing trust model — admin tool on a trusted internal network behind TLS — and is documented; do **not** rely on chat identity for anything security-relevant. If you need stronger identity, deploy NRCC behind an SSO/OIDC proxy and use the proxy's user header.
- **Persistence.** None. Messages live in the NRCC process's memory only and are lost on restart. The buffer is a per-VM ring of size `NRCC_CHAT_BUFFER`; older messages drop off as new ones arrive.
- **Heartbeat.** The client pings every 30 s; the server terminates sockets that miss two pings, which keeps presence accurate when a tab is suspended or NAT'd through a stateful proxy.

The badge on the chat icon counts unread messages received while the panel was minimized; opening the panel clears the count for the active VM. There's no DM, no file/image attachments, and no chat surfacing in the Wall of Eyes window — those are all out of scope.

### Per-VM screenshots

Available in both modes. Each console tab grows two action-bar buttons:

- **Screenshot** — captures the noVNC `<canvas>` of the active console as a PNG and `POST`s it to `/api/screenshots/:vmUuid`. The server saves it as `<NRCC_SCREENSHOTS_DIR>/<uuid>/<ISO-timestamp>.png` (colons in the timestamp replaced with `-` for FS portability). After every save the per-VM folder is pruned to the newest `NRCC_SCREENSHOT_MAX_PER_VM` files (default 100). The status bar reports the saved filename and the prune count.
- **Browse...** — opens a thumbnail-grid modal listing every saved screenshot for the active VM, newest first. Each tile shows timestamp + size and has Download / Delete actions. A Refresh button re-lists the folder.

Layout on disk:

```text
screenshots/
  d1e0f4a8-1234-4abc-89de-0123456789ab/
    2026-05-08T20-14-03.512Z.png
    2026-05-08T20-15-22.001Z.png
  e2f1g5b9-2345-4bcd-90ef-1234567890bc/
    ...
```

Hard limits enforced server-side:

- Encoded payload capped at 10 MB (~7 MB of decoded PNG); larger captures are rejected with HTTP 413.
- The PNG magic bytes are checked; non-PNG payloads are rejected with HTTP 400.
- The UUID and filename in every endpoint path are validated against strict regexes (`^[0-9a-f-]{36}$` and `^[\w.-]+\.png$`), so a malicious path component can't escape the per-VM directory.

The `express.json()` body limit is bumped to `12mb` to accommodate full-resolution console captures.

---

## Endpoints used

| Purpose                | Endpoint                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------- |
| List VMs (PC)          | `GET /api/vmm/v4.x/ahv/config/vms?$includeHidden=true&$page=N&$limit=100`             |
| Discover clusters (PC) | `GET /api/clustermgmt/v4.x/config/clusters?$limit=100`                                |
| List CVMs (PC)         | `GET /api/clustermgmt/v4.x/config/clusters/{cluster}/cvms?$limit=100`                 |
| Cluster external IP    | `GET /api/clustermgmt/v4.x/config/clusters/{cluster}`                                 |
| CVM lookup (PE)        | `POST /api/nutanix/v3/groups` body `{entity_type:"vm",...}`                           |
| Generate token (PC/PE) | `POST /api/vmm/v4.x/ahv/config/vms/{uuid}/$actions/generate-console-token`            |
| Task poll              | `GET /api/prism/v4.0/config/tasks/{taskUuid}`                                         |
| Console WebSocket (v4) | `WSS /<console_websocket_uri>?VmConsoleToken=<token>`                                 |
| Console WebSocket (PE) | `WSS /vnc/vm/{uuid}/proxy`                                                            |
| PE auth probe          | `GET /PrismGateway/services/rest/v2.0/cluster`                                        |
| PE legacy login        | `POST /PrismGateway/j_spring_security_check` (form) — for session cookie if needed    |
| Validate + cache PE creds (NRCC) | `POST /api/pe-test` — server stores creds under the session cookie          |
| List cached PE hosts (NRCC)      | `GET /api/pe-creds` — returns `{ peHosts: [...] }`, no creds                |
| Forget cached PE creds (NRCC)    | `DELETE /api/pe-creds` (all) or `DELETE /api/pe-creds/:peHost` (one)        |
| Server-side logout (NRCC)        | `POST /api/logout` — clears cached PE creds + the chat identity stash       |
| Deployment mode probe (NRCC)     | `GET /api/config` — returns `{multiUser, chatBufferSize, screenshotMaxPerVm, currentUser}` |
| Save screenshot (NRCC)           | `POST /api/screenshots/:vmUuid` — body `{pngBase64}`                        |
| List screenshots (NRCC)          | `GET /api/screenshots/:vmUuid` — newest first                               |
| Fetch screenshot (NRCC)          | `GET /api/screenshots/:vmUuid/:filename` — `image/png`                      |
| Delete screenshot (NRCC)         | `DELETE /api/screenshots/:vmUuid/:filename`                                 |
| Multi-user chat (NRCC)           | `WS(S) /ws-chat` — protocol: `join`/`msg`/`ping`/`leave` (multi-user mode only) |

All requests carry per-call `NTNX-Request-Id` / `X-Request-Id` headers (UUIDv4) — required by Nutanix v4 APIs.

---

## Troubleshooting

| Symptom                                                                | Likely cause                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Failed to list VMs. self-signed certificate`                          | Tick **Allow self-signed TLS**.                                                                                                                                                                       |
| `Failed to list VMs. connect ECONNREFUSED <host>:9440`                 | NRCC server can't reach PC on port 9440. Run NRCC on a host that can.                                                                                                                                 |
| `Failed to list VMs. timeout of NNNNms exceeded`                       | A Prism Central VM-list probe took longer than `NUTANIX_API_TIMEOUT_MS` (default 30 s). Bump the env var or check PC load. The new server log line `All N VM-list probes failed against …` shows the actual per-URL failure reasons. |
| `Loaded N VMs (0 CVM)` despite ticking **Include hidden/system VMs**   | PC's clustermgmt API returned 0 CVMs for those clusters (e.g., the cluster is the PC cluster itself, which returns `CLU-10006: cvm list not supported on PC cluster`). Expected for the PC self-cluster. |
| `Could not locate the CVM on its Prism Element`                        | PE returned no VM matching the CVM IP/name. Open the **Probe trace** in the error to see which endpoint returned what. Most often: PE creds are wrong, or PE is unreachable from NRCC.                  |
| `PE rejected those credentials (401)`                                  | PE credentials are wrong. The modal will offer to re-enter them.                                                                                                                                      |
| Console connects, then **Disconnected ... Clean: false**               | Upstream WebSocket dropped — usually the session expired (10-minute idle window) or the cluster restarted. Click **Open Console** again.                                                              |
| `Generate console token task failed. ... [VMM-30100]`                  | The UUID isn't an AHV VM on the targeted Prism. Refresh the VM list — for CVMs, NRCC needs to re-resolve to the correct AHV UUID.                                                                     |

For deeper diagnostics, check the NRCC server log (`npm start` console). Probes log `[cvm-probe]`, `[pe-test]`, `[pe-resolve]`, `[pe-hosts]`, `[pe-legacy-auth]` lines that document each step.

---

## Security notes

- Never run NRCC on a host that is also reachable by untrusted users — there is no built-in auth on the NRCC port itself, so anyone who can hit `localhost:3000` inherits the cached PE session.
- Never expose port 3000 beyond `localhost` without an HTTPS reverse proxy and an authentication layer in front.
- PE/PC credentials are sent over HTTPS to Prism but transit `localhost` HTTP between the browser and NRCC. This is fine on a workstation but not over a multi-user terminal server.
- PE credentials are cached **only** in the NRCC server process's memory, scoped to an `HttpOnly`, `SameSite=Strict` session cookie (`nrcc_sid`), with an 8-hour rolling inactivity TTL. They are never written to browser storage and never returned in an API response. To wipe them, click **Forget PE credentials** or restart the NRCC process.
- Rotate any credentials you used while testing in this tool.

---

## Reference

- [Nutanix.dev — Launch VM console outside Nutanix Prism UI](https://www.nutanix.dev/2026/05/01/vm-console-external-access/) — the v4 `generate-console-token` flow that NRCC's PC path is built on.
- [Nutanix v4 API portal](https://developers.nutanix.com/) — vmm and clustermgmt namespaces.
- [noVNC](https://novnc.com/) — the JavaScript VNC client embedded in the browser.

---

## License

ISC.
