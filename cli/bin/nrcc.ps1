# =====================================================================
# NRCC launcher (Windows, PowerShell).
#
# Reads <InstallDir>\install.json (written by install.ps1) to decide
# whether to drive `docker compose` or a PID-tracked Node process.
# =====================================================================

[CmdletBinding()]
param(
  [Parameter(Position=0)] [string] $Command = '',
  [Parameter(Position=1, ValueFromRemainingArguments=$true)] [string[]] $Rest
)

$ErrorActionPreference = 'Stop'

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir  = Split-Path -Parent $ScriptDir
$InstallJson = Join-Path $InstallDir 'install.json'

if (-not (Test-Path $InstallJson)) {
  Write-Host "nrcc: missing $InstallJson -- did the installer finish?" -ForegroundColor Red
  exit 1
}

$Cfg     = Get-Content $InstallJson -Raw | ConvertFrom-Json
$Method  = $Cfg.method
$Url     = $Cfg.url
$Port    = [int]$Cfg.port
$AppDir  = $Cfg.appDir
$NodePath= $Cfg.nodePath
$Repo    = $Cfg.repo
$Branch  = $Cfg.branch

$PidFile = Join-Path $InstallDir 'nrcc.pid'
$LogFile = Join-Path $InstallDir 'nrcc.log'

function Write-Log  ([string]$msg) { Write-Host "[nrcc] $msg" -ForegroundColor Cyan }
function Write-Ok   ([string]$msg) { Write-Host "[nrcc] $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg) { Write-Host "[nrcc] $msg" -ForegroundColor Yellow }
function Die        ([string]$msg) { Write-Host "[nrcc] ERROR: $msg" -ForegroundColor Red; exit 1 }

function Test-Port([int]$p) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect('127.0.0.1', $p, $null, $null)
    $ok  = $iar.AsyncWaitHandle.WaitOne(500)
    if ($ok) { $tcp.EndConnect($iar) }
    $tcp.Close()
    return $ok
  } catch { return $false }
}

function Wait-Port([int]$p, [int]$timeoutSec = 30) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $p) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Open-Url([string]$u) { Start-Process $u | Out-Null }

function Is-Running {
  switch ($Method) {
    'docker' {
      Push-Location $InstallDir
      try {
        $svc = & docker compose ps --status running --services 2>$null
        return ($svc -split "`n") -contains 'nrcc'
      } finally { Pop-Location }
    }
    'source' {
      if (-not (Test-Path $PidFile)) { return $false }
      $pidVal = (Get-Content $PidFile -Raw).Trim()
      if (-not $pidVal) { return $false }
      try {
        $proc = Get-Process -Id ([int]$pidVal) -ErrorAction Stop
        return ($null -ne $proc)
      } catch { return $false }
    }
  }
  return $false
}

function Cmd-Start {
  if (Is-Running) { Write-Ok "Already running -- $Url"; return }
  switch ($Method) {
    'docker' {
      Write-Log "Starting NRCC + guacd via docker compose ..."
      Push-Location $InstallDir
      try {
        & docker compose up -d
        if ($LASTEXITCODE -ne 0) { Die "docker compose up failed" }
      } finally { Pop-Location }
    }
    'source' {
      if (-not (Test-Path $AppDir))   { Die "App dir not found: $AppDir" }
      if (-not (Test-Path $NodePath)) { Die "Node binary not found: $NodePath" }
      Write-Log "Starting NRCC server (logs: $LogFile) ..."
      $envBlock = @{
        PORT                    = "$Port"
        # NRCC only enables HTTPS when multi-user mode is on; the
        # launcher publishes the URL as https:// so we force it.
        NRCC_MULTI_USER         = 'true'
        NRCC_TLS_CERT_DIR       = "$InstallDir\data\certs"
        NRCC_SCREENSHOTS_DIR    = "$InstallDir\data\screenshots"
        NRCC_RECORDINGS_DIR     = "$InstallDir\data\recordings"
        NRCC_SCRIPTS_DIR        = "$InstallDir\data\scripts"
        NRCC_LOGS_DIR           = "$InstallDir\data\logs"
        NRCC_LOGGING            = 'true'
        NUTANIX_TLS_SKIP_VERIFY = 'true'
      }
      foreach ($k in $envBlock.Keys) {
        if (-not [Environment]::GetEnvironmentVariable($k, 'Process')) {
          [Environment]::SetEnvironmentVariable($k, $envBlock[$k], 'Process')
        }
      }
      $proc = Start-Process -FilePath $NodePath `
        -ArgumentList 'server.js' `
        -WorkingDirectory $AppDir `
        -RedirectStandardOutput $LogFile `
        -RedirectStandardError  "$LogFile.err" `
        -WindowStyle Hidden `
        -PassThru
      $proc.Id | Set-Content -Path $PidFile -Encoding ASCII
    }
  }
  if (Wait-Port $Port 30) { Write-Ok "Running at $Url" }
  else                    { Write-Warn2 "Port $Port did not open within 30s -- check 'nrcc logs'" }
}

function Cmd-Stop {
  switch ($Method) {
    'docker' {
      Write-Log "Stopping NRCC ..."
      Push-Location $InstallDir
      try { & docker compose down } finally { Pop-Location }
    }
    'source' {
      if (Test-Path $PidFile) {
        $pidVal = (Get-Content $PidFile -Raw).Trim()
        if ($pidVal) {
          try {
            $proc = Get-Process -Id ([int]$pidVal) -ErrorAction Stop
            Write-Log "Stopping PID $pidVal ..."
            $proc.CloseMainWindow() | Out-Null
            if (-not $proc.WaitForExit(5000)) { Stop-Process -Id $proc.Id -Force }
          } catch { Write-Warn2 "PID $pidVal not running" }
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
      } else {
        Write-Warn2 "No PID file -- nothing to stop"
      }
    }
  }
  Write-Ok "Stopped"
}

function Cmd-Restart { Cmd-Stop; Cmd-Start }

function Cmd-Status {
  if (Is-Running) {
    Write-Ok   "RUNNING -- $Url  (method: $Method)"
  } else {
    Write-Warn2 "STOPPED       (method: $Method)"
    exit 1
  }
}

function Cmd-Logs {
  switch ($Method) {
    'docker' {
      Push-Location $InstallDir
      try { & docker compose logs -f --tail=200 } finally { Pop-Location }
    }
    'source' {
      if (-not (Test-Path $LogFile)) { Die "No log file at $LogFile yet" }
      Get-Content $LogFile -Wait -Tail 200
    }
  }
}

function Cmd-Open {
  if (-not (Is-Running)) { Cmd-Start }
  Open-Url $Url
}

function Cmd-Upgrade {
  switch ($Method) {
    'docker' {
      Write-Log "Pulling latest container image ..."
      Push-Location $InstallDir
      try {
        & docker compose pull
        & docker compose up -d
      } finally { Pop-Location }
      Write-Ok "Upgrade complete -- $Url"
    }
    'source' {
      if (-not (Test-Path "$AppDir\.git")) { Die "App dir not a git checkout: $AppDir" }
      Write-Log "git pull ..."
      Push-Location $AppDir
      try {
        & git fetch --depth 1 origin $Branch
        & git reset --hard "origin/$Branch"
      } finally { Pop-Location }

      Write-Log "Refreshing dependencies ..."
      $nodeDir = Split-Path -Parent $NodePath
      $npmCmd  = Join-Path $nodeDir 'npm.cmd'
      if (-not (Test-Path $npmCmd)) { $npmCmd = 'npm' }
      Push-Location $AppDir
      try {
        $env:Path = "$nodeDir;$env:Path"
        & $npmCmd ci --omit=dev --no-audit --no-fund
      } finally { Pop-Location }
      Cmd-Restart
    }
  }
}

function Cmd-EnableService {
  $taskName    = 'NRCC'
  $launcherCmd = Join-Path $InstallDir 'bin\nrcc.cmd'
  Write-Log "Registering Scheduled Task '$taskName' (per-user, runs at logon) ..."
  $action    = New-ScheduledTaskAction -Execute $launcherCmd -Argument 'start'
  $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $task      = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Nutanix Remote Console Client autostart'
  Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
  Write-Ok "Enabled. Manage with: schtasks /Query /TN $taskName  or Task Scheduler GUI"
}

function Cmd-DisableService {
  Unregister-ScheduledTask -TaskName 'NRCC' -Confirm:$false -ErrorAction SilentlyContinue
  Write-Ok "Disabled."
}

function Cmd-Uninstall {
  Write-Log "Stopping NRCC ..."
  try { Cmd-Stop } catch {}
  try { Cmd-DisableService } catch {}

  $desktopLink   = Join-Path ([Environment]::GetFolderPath('Desktop')) 'NRCC.lnk'
  $startMenuDir  = Join-Path ([Environment]::GetFolderPath('Programs')) 'NRCC'
  Remove-Item $desktopLink -Force -ErrorAction SilentlyContinue
  Remove-Item $startMenuDir -Recurse -Force -ErrorAction SilentlyContinue

  $launcherDir = Join-Path $InstallDir 'bin'
  $userPath    = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath) {
    $kept   = ($userPath -split ';') | Where-Object { $_ -and ($_ -ine $launcherDir) }
    $newPath= ($kept -join ';')
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  }

  Write-Log "Removing $InstallDir ..."
  # Self-removal: respawn a detached shell to delete this script's parent.
  $cleanup = "Start-Sleep -Seconds 1; Remove-Item -Recurse -Force '$InstallDir'"
  Start-Process powershell -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-Command', $cleanup) | Out-Null
  Write-Ok "Uninstalled."
}

function Cmd-Help {
  Write-Host ""
  Write-Host "nrcc -- Nutanix Remote Console Client launcher" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Usage: nrcc <command>"
  Write-Host ""
  Write-Host "Commands:"
  Write-Host "  start              start NRCC (docker compose up -d, or background node)"
  Write-Host "  stop               stop NRCC"
  Write-Host "  restart            stop then start"
  Write-Host "  status             show whether NRCC is running"
  Write-Host "  logs               tail server logs"
  Write-Host "  open               open the browser to the NRCC URL (starts NRCC if needed)"
  Write-Host "  upgrade            pull a newer image (docker) or git pull + npm ci (source)"
  Write-Host "  enable-service     register autostart at login (Scheduled Task)"
  Write-Host "  disable-service    un-register autostart"
  Write-Host "  uninstall          stop, disable, and remove the install"
  Write-Host "  help               show this message"
  Write-Host ""
  Write-Host "State:"
  Write-Host "  install dir = $InstallDir"
  Write-Host "  method      = $Method"
  Write-Host "  URL         = $Url"
  Write-Host ""
  Write-Host "Run with no command = start + open."
}

switch ($Command.ToLower()) {
  ''                 { Cmd-Start; Open-Url $Url }
  'start-and-open'   { Cmd-Start; Open-Url $Url }
  'start'            { Cmd-Start }
  'stop'             { Cmd-Stop }
  'restart'          { Cmd-Restart }
  'status'           { Cmd-Status }
  'logs'             { Cmd-Logs }
  'log'              { Cmd-Logs }
  'open'             { Cmd-Open }
  'upgrade'          { Cmd-Upgrade }
  'update'           { Cmd-Upgrade }
  'enable-service'   { Cmd-EnableService }
  'disable-service'  { Cmd-DisableService }
  'uninstall'        { Cmd-Uninstall }
  'remove'           { Cmd-Uninstall }
  'help'             { Cmd-Help }
  '-h'               { Cmd-Help }
  '--help'           { Cmd-Help }
  default            { Die "Unknown command: $Command (try 'nrcc help')" }
}
