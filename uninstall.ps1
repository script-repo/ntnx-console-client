# =====================================================================
# NRCC uninstaller (Windows / PowerShell 5.1+).
#
# Convenience wrapper that calls `nrcc uninstall`. If `nrcc.cmd` isn't
# on PATH, it falls back to the launcher in the default install dir.
#
# Usage:
#   iwr -useb https://raw.githubusercontent.com/script-repo/ntnx-console-client/main/uninstall.ps1 | iex
# =====================================================================

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$NrccInstallDir = if ($env:NRCC_INSTALL_DIR) { $env:NRCC_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'NRCC' }

function Die([string]$msg) { Write-Host "[NRCC] ERROR: $msg" -ForegroundColor Red; exit 1 }

$nrccCmd = Get-Command nrcc -ErrorAction SilentlyContinue
if ($nrccCmd) {
  Write-Host "[NRCC] Running 'nrcc uninstall' ..." -ForegroundColor Cyan
  & $nrccCmd.Source uninstall
  exit $LASTEXITCODE
}

$fallback = Join-Path $NrccInstallDir 'bin\nrcc.cmd'
if (Test-Path $fallback) {
  Write-Host "[NRCC] Running $fallback uninstall ..." -ForegroundColor Cyan
  & $fallback uninstall
  exit $LASTEXITCODE
}

Die "Could not locate the nrcc launcher (expected at $fallback). Set `$env:NRCC_INSTALL_DIR and re-run, or remove $NrccInstallDir by hand."
