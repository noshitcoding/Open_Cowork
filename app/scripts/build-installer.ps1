$ErrorActionPreference = "Stop"

$appRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoRoot = Resolve-Path (Join-Path $appRoot "..")
$installerDir = Join-Path $repoRoot "dist-installers"
$bundleDir = Join-Path $appRoot "src-tauri\target\release\bundle\nsis"
$stableInstallerPath = Join-Path $installerDir "Open-Cowork-Setup.exe"

Push-Location $appRoot
try {
    npm run tauri build
}
finally {
    Pop-Location
}

$latestInstaller = Get-ChildItem -LiteralPath $bundleDir -Filter "*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $latestInstaller) {
    throw "Kein NSIS-Installer gefunden in $bundleDir"
}

New-Item -ItemType Directory -Path $installerDir -Force | Out-Null
Copy-Item -LiteralPath $latestInstaller.FullName -Destination $stableInstallerPath -Force

Write-Host "Installer gebaut:"
Write-Host $latestInstaller.FullName
Write-Host ""
Write-Host "Kopie fuer Weitergabe:"
Write-Host $stableInstallerPath
