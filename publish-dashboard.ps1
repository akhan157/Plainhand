$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$StaticDir = Join-Path $env:TEMP ("career-ops-dashboard-" + [guid]::NewGuid().ToString("N"))
$ExitCode = 0

Push-Location $Root
try {
  npm run dashboard:build-static -- --out $StaticDir
  if ($LASTEXITCODE -ne 0) {
    throw "static build failed (exit $LASTEXITCODE)"
  }

  # Pin the deploy to the existing Vercel project. Without this, each publish
  # creates a brand-new project (the temp dir is never linked) and old copies
  # of the dashboard pile up publicly.
  $ScopeArgs = @(); if ($env:VERCEL_SCOPE) { $ScopeArgs = @("--scope", $env:VERCEL_SCOPE) }
  $Project = if ($env:VERCEL_PROJECT) { $env:VERCEL_PROJECT } else { "dashboard-static" }
  $TokenArgs = @()
  if ($env:VERCEL_TOKEN) {
    $TokenArgs = @("--token", $env:VERCEL_TOKEN)
  }

  & vercel link --yes --cwd $StaticDir --project $Project @ScopeArgs @TokenArgs
  if ($LASTEXITCODE -ne 0) {
    throw "vercel link failed (exit $LASTEXITCODE)"
  }
  & vercel deploy --cwd $StaticDir --prod --yes @ScopeArgs @TokenArgs
  if ($LASTEXITCODE -ne 0) {
    throw "vercel deploy failed (exit $LASTEXITCODE)"
  }
}
catch {
  Write-Error $_
  $ExitCode = 1
}
finally {
  if (Test-Path $StaticDir) {
    Remove-Item $StaticDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}

exit $ExitCode
