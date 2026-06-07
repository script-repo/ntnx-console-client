<#
.SYNOPSIS
  NRCC AudioPatch -- Windows client installer (beta: audioPatch).

.DESCRIPTION
  Run inside the guest Windows VM (not on NRCC). Checks prerequisites
  (Node.js >= 18, ffmpeg, and a virtual audio cable such as VB-CABLE),
  installs the Node agent dependencies, validates the agent, and
  registers a Scheduled Task that keeps the AudioPatch agent connected
  to the NRCC portal at logon.

  Output direction (VM audio -> admin) works out of the box once a
  virtual audio cable is installed and set as the default playback
  device. Input direction (admin mic -> VM) is opt-in on Windows and
  requires a playback target ffmpeg can write to (see -PlaybackSink and
  the README); without it, input frames are dropped.

.PARAMETER Portal
  NRCC portal client endpoint, e.g. wss://nrcc.example/ws-audiopatch/client. (required)

.PARAMETER Uuid
  Prism VM UUID; must match the NRCC VM list. (required)

.PARAMETER Token
  Portal registration token, if NRCC_AUDIOPATCH_TOKEN is configured.

.PARAMETER Name
  Display name shown in PatchBay (default: computer name).

.PARAMETER Session
  Free-form session label.

.PARAMETER Direction
  output | input | both (default: output).

.PARAMETER Rate
  PCM sample rate in Hz (default: 48000).

.PARAMETER CaptureSource
  ffmpeg dshow capture device. Default targets VB-CABLE's output.

.PARAMETER PlaybackSink
  ffmpeg playback target for input direction (advanced; see README).

.PARAMETER NoService
  Validate/install only; do not register the Scheduled Task.

.EXAMPLE
  .\install-client.ps1 -Portal wss://nrcc.example/ws-audiopatch/client -Uuid 0a1b2c3d-... -Token secret -Direction output
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Portal,
  [Parameter(Mandatory = $true)][string]$Uuid,
  [string]$Token = "",
  [string]$Name = $env:COMPUTERNAME,
  [string]$Session = "",
  [ValidateSet("output", "input", "both")][string]$Direction = "output",
  [int]$Rate = 48000,
  [string]$CaptureSource = "audio=CABLE Output (VB-Audio Virtual Cable)",
  [string]$PlaybackSink = "",
  [switch]$NoService
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Log  { param([string]$m) Write-Host "[audiopatch-install] $m" }
function Write-Warn { param([string]$m) Write-Warning "[audiopatch-install] $m" }
function Fail       { param([string]$m) Write-Error "[audiopatch-install] ERROR: $m"; exit 1 }

# ---- Prerequisite checks ----------------------------------------------
Write-Log "Checking prerequisites..."

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js >= 18 is required. Install from https://nodejs.org and re-run." }
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) { Fail "Node.js >= 18 required (found $(node -v))." }

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm is required. Re-install Node.js." }

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
  Write-Log ("ffmpeg: " + ((ffmpeg -version) | Select-Object -First 1))
} else {
  Fail "ffmpeg is required and must be on PATH. Install it (e.g. 'winget install Gyan.FFmpeg') and re-run."
}

# Virtual audio cable check: look for a 'CABLE' dshow audio device.
Write-Log "Checking for a virtual audio cable (VB-CABLE)..."
$dshow = & ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1
if ($dshow -match "CABLE") {
  Write-Log "Found a CABLE audio device."
} else {
  Write-Warn "No 'CABLE' device detected. Install VB-CABLE (https://vb-audio.com/Cable/) and set it as the default Playback device so VM audio routes into it."
  Write-Warn "Detected dshow audio devices:"
  ($dshow | Select-String -Pattern "DirectShow audio" -Context 0,8) | ForEach-Object { Write-Host $_ }
}

# ---- Agent dependencies -----------------------------------------------
Write-Log "Installing agent dependencies (ws) in $Here..."
Push-Location $Here
try {
  & npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
} finally {
  Pop-Location
}

# ---- Validate the agent ------------------------------------------------
Write-Log "Validating the agent script..."
& node --check (Join-Path $Here "audiopatch-agent.mjs")
if ($LASTEXITCODE -ne 0) { Fail "Agent script failed syntax validation." }

if ($Direction -ne "output" -and -not $PlaybackSink) {
  Write-Warn "Direction '$Direction' requested but -PlaybackSink is empty. Input audio will be dropped on Windows until a playback target is configured (see README)."
}

# ---- Scheduled Task ----------------------------------------------------
if ($NoService) {
  Write-Log "Skipping Scheduled Task (-NoService). Run manually with:"
  Write-Host "  `$env:AUDIOPATCH_PORTAL='$Portal'; `$env:AUDIOPATCH_VM_UUID='$Uuid'; node `"$Here\audiopatch-agent.mjs`" --direction $Direction"
  exit 0
}

$nodePath = $node.Source
$agent = Join-Path $Here "audiopatch-agent.mjs"

# Build the argument list. Quote values to survive the Task scheduler.
$agentArgs = @(
  "`"$agent`"",
  "--portal", "`"$Portal`"",
  "--uuid", "`"$Uuid`"",
  "--name", "`"$Name`"",
  "--session", "`"$Session`"",
  "--direction", $Direction,
  "--rate", $Rate,
  "--capture-source", "`"$CaptureSource`""
)
if ($Token) { $agentArgs += @("--token", "`"$Token`"") }
if ($PlaybackSink) { $agentArgs += @("--playback-sink", "`"$PlaybackSink`"") }
$argString = $agentArgs -join " "

$taskName = "NRCC-AudioPatch"
Write-Log "Registering Scheduled Task '$taskName'..."

$action  = New-ScheduledTaskAction -Execute $nodePath -Argument $argString -WorkingDirectory $Here
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable

try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Log "Scheduled Task '$taskName' registered and started. Useful commands:"
Write-Host "  Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo"
Write-Host "  Stop-ScheduledTask  -TaskName $taskName"
Write-Host "  Start-ScheduledTask -TaskName $taskName"
Write-Host "  Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false   # remove"
