# =====================================================================
# NRCC one-line installer (Windows / PowerShell 5.1+).
# =====================================================================
#
# Usage:
#   iwr -useb https://raw.githubusercontent.com/script-repo/ntnx-console-client/main/install.ps1 | iex
#
# Optional environment overrides (set before invoking):
#   $env:NRCC_INSTALL_DIR   default $env:LOCALAPPDATA\NRCC
#   $env:NRCC_BRANCH        default main
#   $env:NRCC_REPO          default https://github.com/script-repo/ntnx-console-client
#   $env:NRCC_RAW           default https://raw.githubusercontent.com/script-repo/ntnx-console-client/$NRCC_BRANCH
#   $env:NRCC_FORCE_METHOD  unset  (set to "docker" or "source" to skip auto-detect)
#   $env:NRCC_PORT          default 8443
#   $env:NRCC_NO_OPEN       unset  (set to 1 to skip launching the browser)
# =====================================================================

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# ---- defaults / env overrides ---------------------------------------
$NrccInstallDir = if ($env:NRCC_INSTALL_DIR) { $env:NRCC_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'NRCC' }
$NrccBranch     = if ($env:NRCC_BRANCH)      { $env:NRCC_BRANCH }      else { 'main' }
$NrccRepo       = if ($env:NRCC_REPO)        { $env:NRCC_REPO }        else { 'https://github.com/script-repo/ntnx-console-client' }
$NrccRaw        = if ($env:NRCC_RAW)         { $env:NRCC_RAW }         else { "https://raw.githubusercontent.com/script-repo/ntnx-console-client/$NrccBranch" }
$NrccPort       = if ($env:NRCC_PORT)        { [int]$env:NRCC_PORT }   else { 8443 }
$NrccForce      = $env:NRCC_FORCE_METHOD

# ---- pretty logging --------------------------------------------------
function Write-Log  ([string]$msg) { Write-Host "[NRCC] $msg" -ForegroundColor Cyan }
function Write-Ok   ([string]$msg) { Write-Host "[NRCC] $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg) { Write-Host "[NRCC] $msg" -ForegroundColor Yellow }
function Die        ([string]$msg) { Write-Host "[NRCC] ERROR: $msg" -ForegroundColor Red; exit 1 }

function Test-Cmd([string]$name) {
  $null -ne (Get-Command -Name $name -ErrorAction SilentlyContinue)
}

# Expand-Archive landed in PowerShell 5.0; Windows Server 2012 R2 ships
# with PowerShell 4.0. Fall back to System.IO.Compression.ZipFile, which
# is available on every box with .NET 4.5+ (ie. 2012 R2 and later).
# Stop any node.exe whose path lives under the install dir, so it can no
# longer hold file handles open under runtime\ or app\. Best-effort: we
# never raise.
function Stop-RunningNrcc {
  $rootLower = $NrccInstallDir.ToLower()
  Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -and $_.Path.ToLower().StartsWith($rootLower) }
    catch { $false }
  } | ForEach-Object {
    try {
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      Write-Log "Stopped lingering node.exe pid=$($_.Id)"
    } catch {}
  }
}

# Recursively delete a directory, riding out the file-in-use / antivirus
# / NTFS handle-release lag that bites every Windows install on a re-run.
# If the dir simply will not let go, rename it out of the way so the
# install can still proceed; the user can clean up the .old.* sibling later.
function Reset-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Stop-RunningNrcc
  for ($i = 0; $i -lt 6; $i++) {
    try {
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      return
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  $bak = "$Path.old.$([DateTime]::Now.ToString('yyyyMMddHHmmss'))"
  try {
    Move-Item -LiteralPath $Path -Destination $bak -Force -ErrorAction Stop
    Write-Warn2 "Could not delete '$Path' (file in use). Renamed to '$bak' so the install can continue. Remove that folder later when the file handle is released (a reboot always clears it)."
  } catch {
    Die "Could not delete or rename '$Path'. Close any node.exe / explorer / antivirus that is browsing it and re-run the installer."
  }
}

# Build a real multi-resolution Windows .ico from a source PNG so that
# Desktop / Start Menu shortcuts get a proper icon. .lnk's IconLocation
# requires .ico -- pointing it at a PNG silently degrades to the cmd.exe
# default. Each frame is encoded as PNG inside the ICO container; Vista+
# parses that fine and PNG keeps alpha channel + small file size for
# the larger sizes (especially 256x256).
function Convert-PngToIco([string]$PngPath, [string]$IcoPath) {
  Add-Type -AssemblyName System.Drawing
  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $original = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $PngPath).ProviderPath)
  $frames = @()
  try {
    foreach ($size in $sizes) {
      $bmp = New-Object System.Drawing.Bitmap $size, $size
      $g   = [System.Drawing.Graphics]::FromImage($bmp)
      $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.DrawImage($original, 0, 0, $size, $size)
      $g.Dispose()

      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      $frames += ,@{ Size = $size; Bytes = $ms.ToArray() }
      $ms.Dispose()
    }
  } finally {
    $original.Dispose()
  }

  $fs = [System.IO.File]::Create($IcoPath)
  $bw = New-Object System.IO.BinaryWriter $fs
  try {
    # ICONDIR header (6 bytes)
    $bw.Write([UInt16]0)                # reserved, must be 0
    $bw.Write([UInt16]1)                # type 1 = ICO
    $bw.Write([UInt16]$frames.Count)    # number of images

    # ICONDIRENTRY (16 bytes each)
    $offset = 6 + (16 * $frames.Count)
    foreach ($f in $frames) {
      $sz = if ($f.Size -ge 256) { 0 } else { $f.Size }   # 256 is encoded as 0
      $bw.Write([byte]$sz)              # width
      $bw.Write([byte]$sz)              # height
      $bw.Write([byte]0)                # color count (0 = no palette / true colour)
      $bw.Write([byte]0)                # reserved
      $bw.Write([UInt16]1)              # color planes
      $bw.Write([UInt16]32)             # bits per pixel
      $bw.Write([UInt32]$f.Bytes.Length)
      $bw.Write([UInt32]$offset)
      $offset += $f.Bytes.Length
    }

    foreach ($f in $frames) { $bw.Write($f.Bytes) }
  } finally {
    $bw.Flush()
    $bw.Close()
  }
}

function Expand-Zip([string]$ZipPath, [string]$Destination) {
  if (Get-Command Expand-Archive -ErrorAction SilentlyContinue) {
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force
    return
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (-not (Test-Path $Destination)) {
    $null = New-Item -ItemType Directory -Force -Path $Destination
  }
  # Resolve full paths -- ExtractToDirectory rejects relative paths and
  # also rejects paths that haven't been canonicalised by .NET.
  $zipFull = (Resolve-Path -LiteralPath $ZipPath).ProviderPath
  $dstFull = (Resolve-Path -LiteralPath $Destination).ProviderPath
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipFull, $dstFull)
}

if ([System.IntPtr]::Size -ne 8) {
  Write-Warn2 "32-bit PowerShell detected -- some downloads may fail. Re-run from 64-bit PowerShell if needed."
}

# Force TLS 1.2 for download compatibility on older Windows shells.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

Write-Log "Install dir: $NrccInstallDir"
Write-Log "Branch:      $NrccBranch"

# ---- choose method --------------------------------------------------

function Choose-Method {
  if ($NrccForce) { return $NrccForce }
  if (Test-Cmd 'docker') {
    try {
      $null = & docker info 2>$null
      if ($LASTEXITCODE -eq 0) { return 'docker' }
    } catch {}
  }
  return 'source'
}

$Method = Choose-Method
switch ($Method) {
  'docker' { Write-Ok  "Method: Docker (RDP works out of the box via guacd sidecar)" }
  'source' { Write-Ok  "Method: source (Node.js); RDP needs a separate guacd install -- see README" }
  default  { Die "NRCC_FORCE_METHOD must be 'docker' or 'source' (got '$Method')" }
}

# ---- prep dirs ------------------------------------------------------

$null = New-Item -ItemType Directory -Force -Path $NrccInstallDir, "$NrccInstallDir\bin", "$NrccInstallDir\data" | Out-Null

# ---- fetcher --------------------------------------------------------

function Fetch([string]$url, [string]$dst) {
  Write-Log "  GET $url"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $dst
}

# ---- download CLI launcher + icon ----------------------------------

Write-Log "Fetching launcher and assets from $NrccRaw ..."
Fetch "$NrccRaw/cli/bin/nrcc.ps1"   "$NrccInstallDir\bin\nrcc.ps1"
Fetch "$NrccRaw/cli/bin/nrcc.cmd"   "$NrccInstallDir\bin\nrcc.cmd"
Fetch "$NrccRaw/public/assets/nrcc-logo.png" "$NrccInstallDir\icon.png"

# .lnk shortcuts need a real .ico file -- generate one alongside the PNG.
try {
  Convert-PngToIco "$NrccInstallDir\icon.png" "$NrccInstallDir\icon.ico"
  Write-Log "Generated icon.ico from icon.png"
} catch {
  Write-Warn2 "Failed to build icon.ico ($($_.Exception.Message)) -- shortcuts will use the default icon"
}

# ---- install.json: shared state read by the launcher ---------------

function Write-InstallJson([hashtable]$extra) {
  $base = [ordered]@{
    method      = $Method
    platform    = 'windows'
    arch        = $env:PROCESSOR_ARCHITECTURE
    installDir  = $NrccInstallDir
    repo        = $NrccRepo
    branch      = $NrccBranch
    raw         = $NrccRaw
    port        = "$NrccPort"
    url         = "https://localhost:$NrccPort"
  }
  foreach ($k in $extra.Keys) { $base[$k] = $extra[$k] }
  ($base | ConvertTo-Json -Depth 4) | Set-Content -Path "$NrccInstallDir\install.json" -Encoding UTF8
}
Write-InstallJson @{}

# ---- bootstrap: docker ---------------------------------------------

function Bootstrap-Docker {
  Write-Log "Writing $NrccInstallDir\docker-compose.yml ..."
  Fetch "$NrccRaw/cli/templates/docker-compose.yml" "$NrccInstallDir\docker-compose.yml"
  "NRCC_PORT=$NrccPort" | Set-Content -Path "$NrccInstallDir\.env" -Encoding ASCII

  Write-Log "Pulling images (this can take a minute on first install) ..."
  Push-Location $NrccInstallDir
  try {
    & docker compose pull
    if ($LASTEXITCODE -ne 0) { Die "docker compose pull failed" }
    Write-Log "Starting NRCC + guacd ..."
    & docker compose up -d
    if ($LASTEXITCODE -ne 0) { Die "docker compose up failed" }
  } finally { Pop-Location }
}

# ---- bootstrap: source ----------------------------------------------

function Get-NodeVersionMajor {
  try {
    $v = (& node -v) 2>$null
    if ($v -match 'v(\d+)\.') { return [int]$matches[1] }
  } catch {}
  return 0
}

function Ensure-Node {
  if (Test-Cmd 'node') {
    $maj = Get-NodeVersionMajor
    if ($maj -ge 20) {
      $resolved = (Get-Command node).Source
      Write-Ok "Found Node $((& node -v)) on PATH"
      return $resolved
    }
  }
  Write-Log "Node 20+ not found on PATH -- attempting bootstrap ..."

  if (Test-Cmd 'winget') {
    Write-Log "Installing Node 20 via winget ..."
    try {
      & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent
    } catch {}
    # Refresh PATH for the current session
    $machinePath = [Environment]::GetEnvironmentVariable('Path','Machine')
    $userPath    = [Environment]::GetEnvironmentVariable('Path','User')
    $env:Path    = "$machinePath;$userPath"
    if ((Test-Cmd 'node') -and ((Get-NodeVersionMajor) -ge 20)) {
      return (Get-Command node).Source
    }
    Write-Warn2 "winget install did not put Node on PATH -- falling back to portable runtime"
  }

  # Portable Node zip
  $nodeVer  = 'v20.18.0'
  $arch     = $env:PROCESSOR_ARCHITECTURE.ToLower()
  $nodeArch = if ($arch -eq 'amd64') { 'x64' } elseif ($arch -eq 'arm64') { 'arm64' } else { 'x86' }
  $url      = "https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-$nodeArch.zip"
  $runtime  = "$NrccInstallDir\runtime"
  Reset-Dir $runtime
  $null = New-Item -ItemType Directory -Force -Path $runtime
  $zip = "$runtime\node.zip"
  Fetch $url $zip
  Expand-Zip $zip $runtime
  Remove-Item $zip
  $nodeExe = Get-ChildItem -Path $runtime -Recurse -Filter 'node.exe' | Select-Object -First 1
  if (-not $nodeExe) { Die "Portable Node extraction failed (no node.exe found under $runtime)." }
  Write-Ok "Portable Node ready: $($nodeExe.FullName)"
  return $nodeExe.FullName
}

function Bootstrap-Source {
  # Free file handles from any prior run before we touch app\ or runtime\.
  Stop-RunningNrcc

  $nodePath = Ensure-Node

  if (Test-Path "$NrccInstallDir\app\.git") {
    Write-Log "Updating existing checkout ..."
    Push-Location "$NrccInstallDir\app"
    try {
      & git fetch --depth 1 origin $NrccBranch
      & git reset --hard "origin/$NrccBranch"
    } finally { Pop-Location }
  } else {
    Write-Log "Cloning $NrccRepo (branch $NrccBranch) ..."
    Reset-Dir "$NrccInstallDir\app"
    if (Test-Cmd 'git') {
      & git clone --depth 1 --branch $NrccBranch $NrccRepo "$NrccInstallDir\app"
      if ($LASTEXITCODE -ne 0) { Die "git clone failed" }
    } else {
      Write-Log "git not found -- downloading tarball instead"
      $tar = "$NrccInstallDir\app.zip"
      Fetch "$NrccRepo/archive/refs/heads/$NrccBranch.zip" $tar
      Expand-Zip $tar "$NrccInstallDir\app-tmp"
      $extracted = Get-ChildItem "$NrccInstallDir\app-tmp" | Select-Object -First 1
      Move-Item -Path $extracted.FullName -Destination "$NrccInstallDir\app"
      Remove-Item -Recurse -Force "$NrccInstallDir\app-tmp"
      Remove-Item $tar
    }
  }

  # npm sits next to node.exe on Windows
  $nodeDir = Split-Path -Parent $nodePath
  $npmCmd  = Join-Path $nodeDir 'npm.cmd'
  if (-not (Test-Path $npmCmd)) { $npmCmd = 'npm' }

  Write-Log "Installing npm dependencies (production only) ..."
  Push-Location "$NrccInstallDir\app"
  try {
    $env:Path = "$nodeDir;$env:Path"
    & $npmCmd ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Die "npm ci failed" }
  } finally { Pop-Location }

  Write-InstallJson @{
    nodePath = $nodePath
    appDir   = "$NrccInstallDir\app"
  }

  Write-Log "Starting NRCC ..."
  & "$NrccInstallDir\bin\nrcc.cmd" start
}

switch ($Method) {
  'docker' { Bootstrap-Docker }
  'source' { Bootstrap-Source }
}

# ---- expose launcher on PATH ---------------------------------------

$LauncherDir = "$NrccInstallDir\bin"
$userPath    = [Environment]::GetEnvironmentVariable('Path','User')
if (-not ($userPath -split ';' | Where-Object { $_ -ieq $LauncherDir })) {
  $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $LauncherDir } else { "$userPath;$LauncherDir" }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  $env:Path = "$env:Path;$LauncherDir"
  Write-Ok  "Added $LauncherDir to your user PATH (new shells will see it)"
} else {
  Write-Log "$LauncherDir already on PATH"
}

# ---- desktop + Start Menu shortcuts --------------------------------

function New-Shortcut([string]$LinkPath, [string]$Target, [string]$Arguments, [string]$IconPath) {
  $sh = New-Object -ComObject WScript.Shell
  $sc = $sh.CreateShortcut($LinkPath)
  $sc.TargetPath       = $Target
  $sc.Arguments        = $Arguments
  $sc.WorkingDirectory = $NrccInstallDir
  if ($IconPath) { $sc.IconLocation = $IconPath }
  $sc.Save()
}

$DesktopDir   = [Environment]::GetFolderPath('Desktop')
$StartMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'NRCC'
$null         = New-Item -ItemType Directory -Force -Path $StartMenuDir

# Modern Windows .lnk takes a PNG icon directly.
# Prefer the generated .ico; fall back to .png so we still ship something
# even if Convert-PngToIco failed (in which case Windows shows a blank icon
# rather than crashing the install).
$IconForLnk = if (Test-Path "$NrccInstallDir\icon.ico") { "$NrccInstallDir\icon.ico" } else { "$NrccInstallDir\icon.png" }
New-Shortcut "$DesktopDir\NRCC.lnk"        "$LauncherDir\nrcc.cmd" ""     $IconForLnk
New-Shortcut "$StartMenuDir\NRCC.lnk"      "$LauncherDir\nrcc.cmd" ""     $IconForLnk
New-Shortcut "$StartMenuDir\NRCC Logs.lnk" "$LauncherDir\nrcc.cmd" "logs" $IconForLnk
Write-Ok "Desktop shortcut: $DesktopDir\NRCC.lnk"
Write-Ok "Start Menu folder: $StartMenuDir"

# ---- open browser --------------------------------------------------

if (-not $env:NRCC_NO_OPEN) {
  Write-Log "Waiting for NRCC to come up on https://localhost:$NrccPort ..."
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $iar = $tcp.BeginConnect('127.0.0.1', $NrccPort, $null, $null)
      if ($iar.AsyncWaitHandle.WaitOne(500)) { $tcp.EndConnect($iar); $tcp.Close(); break }
      $tcp.Close()
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  Write-Log "Opening browser ..."
  Start-Process "https://localhost:$NrccPort"
}

Write-Host ""
Write-Host "NRCC is installed." -ForegroundColor Green
Write-Host ""
Write-Host "  URL:           https://localhost:$NrccPort"
Write-Host "  Install dir:   $NrccInstallDir"
Write-Host "  Method:        $Method"
Write-Host "  Launcher:      $LauncherDir\nrcc.cmd"
Write-Host ""
Write-Host "Common commands:" -ForegroundColor Cyan
Write-Host "  nrcc                  start (if needed) and open the browser"
Write-Host "  nrcc start            start the server"
Write-Host "  nrcc stop             stop it"
Write-Host "  nrcc status           is it running?"
Write-Host "  nrcc logs             tail server logs"
Write-Host "  nrcc upgrade          pull a newer version"
Write-Host "  nrcc enable-service   register autostart at login"
Write-Host "  nrcc uninstall        stop everything and remove the install"
Write-Host ""
Write-Host "First-load tip: the TLS cert is self-signed; click through the browser warning once and the cert is then cached." -ForegroundColor DarkGray
