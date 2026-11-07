# One-command Windows install:
#   irm https://raw.githubusercontent.com/akhan157/Plainhand/main/install.ps1 | iex
# Downloads the app, installs dependencies and Chromium, creates a plainhand
# launcher, and starts it. The workspace is kept separately.
$ErrorActionPreference = "Stop"
$Repo = "akhan157/Plainhand"
$HomeDir = if ($env:PLAINHAND_HOME) { $env:PLAINHAND_HOME } else { Join-Path $HOME ".plainhand" }
$BinDir = if ($env:PLAINHAND_BIN_DIR) { $env:PLAINHAND_BIN_DIR } else { Join-Path $HomeDir "bin" }
$App = Join-Path $HomeDir "app"
$Workspace = Join-Path $HomeDir "workspace"
# latest (default) = newest GitHub release; main = development version; or a tag such as v1.1.2.
$Version = if ($env:PLAINHAND_VERSION) { $env:PLAINHAND_VERSION } else { "latest" }
$NoStart = ($env:PLAINHAND_NO_START -eq "1") -or ($args -contains "--no-start")

function Fail($message) {
  Write-Host $message -ForegroundColor Red
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Plainhand needs Node.js 22 or newer. Install it from https://nodejs.org and run this again." }
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { Fail "Plainhand needs Node.js 22 or newer (this is $(& node -v)). Install it from https://nodejs.org and run this again." }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm was not found. Reinstall Node.js from https://nodejs.org."
}

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("plainhand-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
  if ($Version -eq "main") {
    $Ref = "refs/heads/main"; $Label = "development version (main)"
  } elseif ($Version -eq "latest") {
    try {
      $Tag = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "plainhand-installer" }).tag_name
    } catch { $Tag = $null }
    if ($Tag -notmatch '^v[0-9]') { throw "Could not find the latest Plainhand release. Check your connection, or set PLAINHAND_VERSION=main." }
    $Ref = "refs/tags/$Tag"; $Label = $Tag
  } elseif ($Version -match '^v[0-9]') {
    $Ref = "refs/tags/$Version"; $Label = $Version
  } else {
    throw "PLAINHAND_VERSION must be latest, main or a release tag such as v1.1.2."
  }
  Write-Host "Downloading Plainhand $Label..."
  $zip = Join-Path $temp "plainhand.zip"
  Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $temp -Force
  $src = Get-ChildItem -Path $temp -Directory | Where-Object { $_.Name -like "Plainhand-*" } | Select-Object -First 1
  if (-not $src) { throw "The download did not contain Plainhand." }

  New-Item -ItemType Directory -Path $HomeDir -Force | Out-Null
  $newApp = "$App.new"
  if (Test-Path $newApp) { Remove-Item -Path $newApp -Recurse -Force }
  New-Item -ItemType Directory -Path $newApp -Force | Out-Null
  Copy-Item -Path (Join-Path $src.FullName "*") -Destination $newApp -Recurse -Force

  Write-Host "Installing dependencies..."
  Push-Location $newApp
  try {
    $npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } else { "npm" }
    & $npm ci --no-audit --no-fund --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
    Write-Host "Installing Chromium (first run only)..."
    & node "node_modules\playwright\cli.js" install chromium
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Chromium did not install. Plainhand can still run; PDFs and form assistance need it." -ForegroundColor Yellow
    }
  } finally {
    Pop-Location
  }

  if (Test-Path $App) {
    if (Test-Path "$App.old") { Remove-Item -Path "$App.old" -Recurse -Force }
    Move-Item -Path $App -Destination "$App.old"
  }
  Move-Item -Path $newApp -Destination $App
  if (Test-Path "$App.old") { Remove-Item -Path "$App.old" -Recurse -Force }

  New-Item -ItemType Directory -Path $Workspace -Force | Out-Null
  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  $launcher = Join-Path $BinDir "plainhand.cmd"
  @"
@echo off
node "$App\bin\plainhand.mjs" --data-root "$Workspace" %*
"@ | Set-Content -Path $launcher -Encoding ASCII

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $userPath) { $userPath = "" }
  if (($userPath -split ";") -notcontains $BinDir) {
    $nextPath = if ($userPath.Trim()) { "$userPath;$BinDir" } else { $BinDir }
    [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
    $env:Path = "$env:Path;$BinDir"
    Write-Host "Added $BinDir to your user PATH. Open a new terminal to use 'plainhand' there." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Plainhand is installed."
  Write-Host "  Workspace: $Workspace"
  Write-Host "  Launcher:  $launcher"
  if ($NoStart) {
    Write-Host "Run: $launcher"
    exit 0
  }
  & $launcher
} finally {
  Remove-Item -Path $temp -Recurse -Force -ErrorAction SilentlyContinue
}
