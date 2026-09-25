[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [ValidateSet('Caches', 'Builds', 'Dependencies', 'Downloads', 'OldArtifacts')]
    [string[]]$Scope = @('Caches'),
    [switch]$Apply,
    [ValidateRange(1, 365)][int]$OlderThanDays = 14,
    [switch]$Json
)
$ErrorActionPreference = 'Stop'
$mobileRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\')
$repoRoot = Split-Path $mobileRoot -Parent
if (-not (Test-Path -LiteralPath (Join-Path $mobileRoot 'package-lock.json'))) { throw 'Missing lockfile: refusing cleanup.' }
if ((Get-Content -LiteralPath (Join-Path $mobileRoot 'package.json') -Raw | ConvertFrom-Json).name -ne 'life-dashboard-mobile') { throw 'Unexpected project.' }
$paths = [Collections.Generic.List[string]]::new()
if ($Scope -contains 'Caches') {
    foreach ($relative in @('.tools/gradle-cache/caches/9.3.1', '.tools/gradle-cache/caches/jars-9', '.tools/gradle-cache/caches/journal-1', '.tools/gradle-cache/.tmp', '.tools/tmp', 'android/.gradle', 'android/.kotlin')) { $paths.Add($relative) }
}
if ($Scope -contains 'Builds') {
    # Keep native sources, signing files and the current APK in outputs.
    foreach ($relative in @('android/app/build/intermediates', 'android/app/build/generated', 'android/app/build/tmp', 'android/app/build/kotlin', 'android/app/.cxx', 'android/build',
        'node_modules/expo-modules-core/android/build', 'node_modules/expo-modules-core/android/.cxx',
        'node_modules/expo-sqlite/android/build', 'node_modules/expo-sqlite/android/.cxx')) { $paths.Add($relative) }
}
if ($Scope -contains 'Dependencies') {
    foreach ($relative in @('node_modules', '.tools/gradle-cache/caches/modules-2')) { $paths.Add($relative) }
}
if ($Scope -contains 'Downloads') {
    if (Test-Path -LiteralPath (Join-Path $mobileRoot '.tools/jdk-17.0.20.1+1/bin/java.exe')) { $paths.Add('.tools/jdk17.zip') }
    if (Test-Path -LiteralPath (Join-Path $mobileRoot '.tools/android-cli23/cmdline-tools/bin/android.exe')) { $paths.Add('.tools/android-cli23.zip') }
}
if ($Scope -contains 'OldArtifacts') {
    # Opt-in retention only for debug outputs, never release/signing or backups.
    $debugRoot = Join-Path $mobileRoot 'android/app/build/outputs/apk/debug'
    if (Test-Path -LiteralPath $debugRoot) {
        $old = @(Get-ChildItem -LiteralPath $debugRoot -File -Filter '*.apk' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 1 |
            Where-Object LastWriteTime -LT (Get-Date).AddDays(-$OlderThanDays))
        foreach ($item in $old) { $paths.Add($item.FullName.Substring($mobileRoot.Length + 1)) }
    }
}
function Assert-SafeTarget([string]$target) {
    if (-not $target.StartsWith($mobileRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Target escapes mobile_app.' }
    # Refuse symlinks/junctions in any ancestor, and inside the candidate tree.
    $ancestor = $target
    while ($ancestor) {
        if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point refused: $ancestor" }
        $ancestor = Split-Path $ancestor -Parent
    }
    $items = @(Get-Item -LiteralPath $target -Force)
    if ($items[0].PSIsContainer) { $items += @(Get-ChildItem -LiteralPath $target -Force -Recurse) }
    if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw "Nested reparse point refused: $target" }
    if ($items | Where-Object { -not $_.PSIsContainer -and ($_.Name -match '(?i)(\.(jks|keystore|sqlite|sqlite3|db)$|^secrets\.toml$|^\.env($|\.)|^signing\.properties$)') }) { throw "Protected file found: $target" }
    $relative = $target.Substring($repoRoot.Length + 1).Replace('\', '/')
    $tracked = @(& git -C $repoRoot ls-files -- $relative)
    if ($LASTEXITCODE -ne 0 -or $tracked.Count) { throw "Tracked files or Git check failure: $target" }
    return [long](($items | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum)
}
# Deduplicate overlapping directories so estimates never count native outputs twice.
$targets = [Collections.Generic.List[string]]::new()
foreach ($relative in ($paths | Sort-Object Length)) {
    $target = [IO.Path]::GetFullPath((Join-Path $mobileRoot $relative))
    if ((Test-Path -LiteralPath $target) -and -not ($targets | Where-Object { $target.Equals($_, [StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($_ + '\', [StringComparison]::OrdinalIgnoreCase) })) { $targets.Add($target) }
}
$plan = @(foreach ($target in $targets) {
    $bytes = Assert-SafeTarget $target
    [PSCustomObject]@{ Path = $target; Bytes = $bytes; GiB = [Math]::Round($bytes / 1GB, 3) }
})
if ($Json) { $plan | ConvertTo-Json } else {
    $plan | Format-Table -AutoSize
    Write-Host ('Potential recovery: {0:N3} GiB. No SDK/JDK, source, backups or current APK selected.' -f (($plan | Measure-Object Bytes -Sum).Sum / 1GB))
}
if (-not $Apply) { Write-Host 'SIMULATION ONLY. Nothing removed. Explicit -Apply and confirmation required.'; return }
if (Get-Process java,javaw,ninja,cmake,gradle -ErrorAction SilentlyContinue) { throw 'Build process detected. Stop builds/Gradle before cleaning.' }
$nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")
if ($nodeProcesses | Where-Object { -not $_.CommandLine -or $_.CommandLine -match '(?i)(Life_Dashboard_Public|L:\\mobile_app|metro|expo)' }) { throw 'Potential project Node process detected. Stop Metro/npm first.' }
if ($plan.Count -and $PSCmdlet.ShouldProcess(($plan.Path -join "`n"), 'Permanently remove ONLY the listed recreatable files')) {
    # Revalidate the full plan before any delete. Do not run concurrently with builds.
    foreach ($target in $targets) { $null = Assert-SafeTarget $target }
    foreach ($target in $targets) { Remove-Item -LiteralPath $target -Recurse -Force }
    Write-Host 'Listed generated files removed. Restore using npm ci and the local Android build; downloads may be needed.'
}
