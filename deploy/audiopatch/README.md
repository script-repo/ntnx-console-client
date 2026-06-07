# NRCC AudioPatch agent (beta)

Manual VM-side agent for the **AudioPatch** beta feature. The agent runs
*inside a guest VM*, registers with the NRCC AudioPatch portal over a
WebSocket, and relays raw 16-bit PCM audio using `ffmpeg`:

| Direction | Flow | Status |
| --------- | ---- | ------ |
| `output`  | VM system audio → NRCC → admin browser (and recordings) | Windows + Linux |
| `input`   | Admin microphone → NRCC → played inside the VM | Linux (full), Windows (opt-in) |
| `both`    | Output + input at once | Linux (full), Windows (opt-in) |

This is adapted from [CC-Peep](https://github.com/script-repo/CC-Peep)
and speaks NRCC's own portal protocol (`/ws-audiopatch/client`).

> AudioPatch is **disabled by default**. An operator must enable the
> portal on NRCC (`NRCC_AUDIOPATCH_ENABLED=true`, the default build ships
> it on) and each user must tick **AudioPatch** under
> Settings → Show beta features. The agent only needs the portal URL,
> the VM UUID, and (if configured) the registration token.

## Prerequisites

- **Node.js ≥ 18** and **npm** in the guest.
- **ffmpeg** on `PATH`.
- An audio device the agent can capture/play:
  - **Linux:** PulseAudio or PipeWire (`pactl`). Use `setup-linux-audio.sh`
    to create a dedicated `AudioPatch` null sink + monitor.
  - **Windows:** a virtual audio cable such as
    [VB-CABLE](https://vb-audio.com/Cable/). Set it as the default
    **Playback** device so application audio routes into it; the agent
    captures `CABLE Output`.
- The **Prism VM UUID**, exactly as shown in NRCC's VM list. The agent
  must register with this UUID so the action pane's **Patch In** button
  lights up for the matching VM.

## Linux install

```bash
cd deploy/audiopatch
./install-client.sh \
  --portal wss://nrcc.example/ws-audiopatch/client \
  --uuid   0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9 \
  --token  <portal-token-if-required> \
  --direction both \
  --setup-audio
```

What it does:

1. Verifies Node ≥ 18, npm, ffmpeg, and warns if `pactl` is missing.
2. Runs `npm install` (pulls `ws`).
3. With `--setup-audio`, runs `setup-linux-audio.sh` to create the
   `AudioPatch` null sink and points the agent at `AudioPatch.monitor`
   (capture) and `AudioPatch` (playback).
4. Validates the agent with `node --check`.
5. Installs a **systemd user service** `nrcc-audiopatch.service` that
   restarts on failure and on boot.

```bash
systemctl --user status nrcc-audiopatch.service
journalctl --user -u nrcc-audiopatch.service -f
loginctl enable-linger "$USER"   # run without an active login session
```

To prepare audio only (no service): `./setup-linux-audio.sh AudioPatch`.

### ALSA-only hosts

If there is no Pulse/PipeWire server, load the ALSA loopback module
(`sudo modprobe snd-aloop`) and run the agent with
`--capture-format alsa --capture-source hw:Loopback,1,0` (and a matching
`--playback-format alsa --playback-sink hw:Loopback,0,0`).

## Windows install

Run in an elevated PowerShell (needed to register the Scheduled Task):

```powershell
cd deploy\audiopatch
.\install-client.ps1 `
  -Portal wss://nrcc.example/ws-audiopatch/client `
  -Uuid 0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9 `
  -Token <portal-token-if-required> `
  -Direction output
```

What it does:

1. Verifies Node ≥ 18, npm, ffmpeg, and checks for a `CABLE` device.
2. Runs `npm install` (pulls `ws`).
3. Validates the agent with `node --check`.
4. Registers a **Scheduled Task** `NRCC-AudioPatch` that starts at logon
   and restarts on failure.

```powershell
Get-ScheduledTask -TaskName NRCC-AudioPatch | Get-ScheduledTaskInfo
Unregister-ScheduledTask -TaskName NRCC-AudioPatch -Confirm:$false   # remove
```

**Windows input direction.** `ffmpeg` cannot natively play to a Windows
audio device, so `input`/`both` are opt-in: provide a `-PlaybackSink`
ffmpeg can write to (for example a second tool reading stdin, or an
ALSA/Jack bridge). Without it, the agent runs output-only and input
frames are dropped. Output (listening to the VM) needs no extra setup
beyond the virtual cable.

## Manual run (no service)

```bash
AUDIOPATCH_PORTAL=wss://nrcc.example/ws-audiopatch/client \
AUDIOPATCH_VM_UUID=0a1b2c3d-... \
AUDIOPATCH_TOKEN=secret \
node audiopatch-agent.mjs --direction output --rate 48000
```

All flags have `AUDIOPATCH_*` env equivalents — see the header of
`audiopatch-agent.mjs`.

## How it connects to NRCC

- Portal endpoint: `wss://<nrcc-host>/ws-audiopatch/client?token=<token>`.
  The token is only required when the operator sets
  `NRCC_AUDIOPATCH_TOKEN`. NRCC's self-signed lab TLS is accepted by
  default; set `AUDIOPATCH_TLS_STRICT=1` to enforce verification.
- On connect the agent sends
  `{type:"register", vmUuid, vmName, session, capabilities}` then, for
  output, `{type:"audio-format", direction:"output", sampleRate, channels:1, bitsPerSample:16}`
  followed by raw PCM binary frames.
- For input, NRCC forwards the admin's
  `{type:"input-format", format}` and binary mic frames, which the agent
  pipes into the playback `ffmpeg`.
- A `ping` every 25s keeps the VM listed in **PatchBay**; missing
  heartbeats drop it from the registry.

## Validating an install

- Linux: `systemctl --user status nrcc-audiopatch.service` should be
  `active (running)`; logs show `registered: <uuid>`.
- Windows: the `NRCC-AudioPatch` task shows `Running`; the agent console
  /event log shows `registered: <uuid>`.
- In NRCC (with AudioPatch enabled): open **PatchBay** in the action pane
  — the VM appears with a green dot. Open that VM's console and
  **Patch In** becomes clickable. Patching **Output** should play the
  VM's audio; starting a **Record** while patched captures the audio in
  the WebM.
