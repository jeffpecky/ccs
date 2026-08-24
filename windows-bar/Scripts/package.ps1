param(
    [string]$Version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\macos-bar\VERSION') -Raw).Trim(),
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Dist = Join-Path $Root 'dist'
$Publish = Join-Path $Dist 'publish'
$Package = Join-Path $Dist 'CCS Bar'
$Zip = Join-Path $Dist 'CCS-Bar-windows-x64.zip'
$Checksum = "$Zip.sha256"
$Project = Join-Path $Root 'CCSBar.App\CCSBar.App.csproj'

$arguments = @('publish', $Project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true', "-p:Version=$Version", '-o', $Publish)
if ($DryRun) {
    "dotnet $($arguments -join ' ')"
    "Package manifest.json with CCS Bar.exe, runtime=win-x64, selfContained=true, version=$Version"
    "Create CCS-Bar-windows-x64.zip and CCS-Bar-windows-x64.zip.sha256"
    exit 0
}

Remove-Item -LiteralPath $Dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Package -Force | Out-Null
& dotnet @arguments
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed: $LASTEXITCODE" }
Copy-Item -LiteralPath (Join-Path $Publish 'CCS Bar.exe') -Destination $Package
$manifest = @{
    name = 'CCS Bar'
    version = $Version
    runtime = 'win-x64'
    selfContained = $true
    executable = 'CCS Bar.exe'
    ccsRuntime = 'CCS CLI must be installed and resolvable as ccs.exe, ccs.cmd, or ccs on PATH. Bun and source checkout are not required by CCS Bar.'
} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $Package 'manifest.json'), $manifest, [Text.UTF8Encoding]::new($false))
Compress-Archive -LiteralPath $Package -DestinationPath $Zip -Force
$hash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  CCS-Bar-windows-x64.zip" | Set-Content -LiteralPath $Checksum -Encoding ascii
"[OK] $Zip"
"[OK] $Checksum"
