# Snapshot tests never update committed PNGs during normal test runs.
# Set CCS_BAR_UPDATE_SNAPSHOTS=1 explicitly when intentional UI changes require new baselines.
if ($env:CCS_BAR_UPDATE_SNAPSHOTS -ne '1') {
    throw 'Baseline regeneration requires CCS_BAR_UPDATE_SNAPSHOTS=1.'
}

dotnet test "$PSScriptRoot\..\CCSBar.App.Tests\CCSBar.App.Tests.csproj" --filter 'FullyQualifiedName~VisualSnapshotTests'
exit $LASTEXITCODE
