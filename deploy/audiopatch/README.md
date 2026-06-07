# NRCC AudioPatch agent (beta)

The **AudioPatch** agent runs *inside a guest VM*, registers with the
NRCC AudioPatch portal over a WebSocket, and relays raw 16-bit PCM audio
using `ffmpeg`:

| Direction | Flow | Status |
| --------- | ---- | ------ |
| `output`  | VM system audio → NRCC → admin browser (and recordings) | Windows + Linux |
| `input`   | Admin microphone → NRCC → played inside the VM | Linux (full), Windows (opt-in) |
| `both`    | Output + input at once | Linux (full), Windows (opt-in) |

It is adapted from [CC-Peep](https://github.com/script-repo/CC-Peep) and
speaks NRCC's own portal protocol (`/ws-audiopatch/client`).

> **You do not clone this repo to install the agent, and you do not need a
> VM UUID.** NRCC serves the agent and a templated, zero-flag installer.
> The agent reports its own MAC/IP/hostname and NRCC resolves the matching
> Prism VM UUID server-side. The files in this folder are reference copies;
> the canonical, served versions live under `public/audiopatch/`.

> AudioPatch is **disabled by default**. An operator must enable the portal
> (`NRCC_AUDIOPATCH_ENABLED=true`) and each user ticks **AudioPatch** under
> Settings → Show beta features.

## One-liner install (recommended)

Run inside the guest, pointing at your NRCC host (the same address you use
in the browser). NRCC fills in the portal URL, token and download links.

**Linux:**

```bash
curl -fsSLk https://<nrcc-host>/audiopatch/install.sh | bash
```

Add options after a `-s --`, e.g. capture + playback with a dedicated sink:

```bash
curl -fsSLk https://<nrcc-host>/audiopatch/install.sh | bash -s -- --direction both --setup-audio
```

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::ServerCertificateValidationCallback={$true}; iwr https://<nrcc-host>/audiopatch/install.ps1 -UseBasicParsing | iex"
```

The exact one-liner for your deployment (with the host already filled in)
is shown in NRCC under **PatchBay → Add a VM**.

### What the installer does

1. Verifies Node ≥ 18 and warns if `ffmpeg` is missing.
2. Downloads the agent from `https://<nrcc-host>/audiopatch/audiopatch-agent.mjs`.
3. Installs the `ws` WebSocket dependency locally (falls back to the Node
   built-in WebSocket on Node ≥ 22 if npm is unavailable).
4. Linux `--setup-audio`: creates the `AudioPatch` null sink + monitor and
   points the agent at them.
5. Installs a restart-on-failure service — **systemd user service**
   `nrcc-audiopatch` on Linux, **Scheduled Task** `NRCC-AudioPatch` on
   Windows — with the portal URL and token baked in.

Useful commands:

```bash
# Linux
systemctl --user status nrcc-audiopatch
journalctl --user -u nrcc-audiopatch -f
loginctl enable-linger "$USER"   # run without an active login session
```

```powershell
# Windows
Get-ScheduledTask -TaskName NRCC-AudioPatch | Get-ScheduledTaskInfo
Unregister-ScheduledTask -TaskName NRCC-AudioPatch -Confirm:$false   # remove
```

## Identity & resolution

The agent registers with `{type:"register", identity:{macs, ips, dmiUuid,
hostname}, ...}` — no `vmUuid` required. NRCC matches those signals to the
VM inventory (MAC → IP → DMI UUID → hostname) and binds the agent to the
right Prism VM. If no operator has loaded the VM list yet, the agent shows
in PatchBay as *unresolved* and binds automatically once the inventory is
fetched. Pass `--uuid <uuid>` only to force a specific VM.

## Manual run (no install)

```bash
curl -fsSLk https://<nrcc-host>/audiopatch/audiopatch-agent.mjs -o audiopatch-agent.mjs
npm install ws    # or run on Node >= 22 for the built-in WebSocket
AUDIOPATCH_PORTAL=wss://<nrcc-host>/ws-audiopatch/client \
AUDIOPATCH_TOKEN=<token-if-required> \
node audiopatch-agent.mjs --direction output
```

All flags have `AUDIOPATCH_*` env equivalents — see the header of
`public/audiopatch/audiopatch-agent.mjs`. NRCC's self-signed lab TLS is
accepted by default; set `AUDIOPATCH_TLS_STRICT=1` to enforce verification.

### ALSA-only Linux hosts

With no Pulse/PipeWire server, load the ALSA loopback module
(`sudo modprobe snd-aloop`) and run with
`--capture-format alsa --capture-source hw:Loopback,1,0`
(and `--playback-format alsa --playback-sink hw:Loopback,0,0`).

### Windows input direction

`ffmpeg` cannot natively play to a Windows audio device, so `input`/`both`
are opt-in: set `AUDIOPATCH_PLAYBACK_SINK` to a target ffmpeg can write to.
Output (listening to the VM) needs only the virtual cable (VB-CABLE).

## Validating an install

- Linux: `systemctl --user status nrcc-audiopatch` is `active (running)`;
  logs show `registered (... resolved=yes)`.
- Windows: the `NRCC-AudioPatch` task shows `Running`.
- In NRCC (AudioPatch enabled): open **PatchBay** — the VM appears with a
  green dot. On that VM's console, **Patch In** becomes clickable. Patching
  **Output** plays the VM's audio; a **Record** while patched captures the
  audio in the WebM.
