param(
    [switch]$Execute,
    [switch]$DryRun,
    [long]$PeakAdditionalBytes = 0,
    [string]$SigningFile = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'LifeDashboard/signing/signing.local.json')
)
$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'dev-storage-budget.ps1')
$budget = Get-DevelopmentStorageBudget -MobileRoot $mobileRoot
$budget | Format-List
if (-not $Execute -and -not $DryRun) {
    Write-Output 'PLAN ONLY. First release peak is not established. No prebuild, download or compilation started.'
    Write-Output 'DryRun performs offline configuration/task-graph checks only (500 MB conservative estimate).'
    Write-Output 'Execute requires a justified PeakAdditionalBytes below the remaining budget; never guess to bypass this guard.'
    exit 0
}
if ($Execute -and $DryRun) { throw 'Choose DryRun or Execute, not both.' }
if ($DryRun) { $PeakAdditionalBytes = 500000000L }
Assert-DevelopmentStoragePeak -Budget $budget -PeakAdditionalBytes $PeakAdditionalBytes
if (-not (Test-Path -LiteralPath $SigningFile)) { throw 'Prepare private signing first: scripts/prepare-android-signing.ps1.' }
$signing = Get-Content -LiteralPath $SigningFile -Raw | ConvertFrom-Json
if ($signing.certificateSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid signing certificate identity.' }
$mapping = @(subst.exe) | Where-Object { $_ -like 'L:\:*' }
$repositoryRoot = Split-Path $mobileRoot -Parent
if ($mapping) {
    if ($mapping.Trim() -ne "L:\: => $repositoryRoot") { throw 'L: belongs to another workspace.' }
} elseif (Test-Path -LiteralPath 'L:\') { throw 'L: is already in use.' }
else { & subst.exe L: $repositoryRoot; if ($LASTEXITCODE -ne 0) { throw 'Short build path unavailable.' } }
$buildRoot = 'L:\mobile_app'
$env:JAVA_HOME = Join-Path $buildRoot '.tools/jdk-17.0.20.1+1'
$env:ANDROID_HOME = Join-Path $buildRoot '.tools/android-sdk'
$env:GRADLE_USER_HOME = Join-Path $buildRoot '.tools/gradle-cache'
$env:LIFE_DASHBOARD_SIGNING_FILE = (Resolve-Path -LiteralPath $SigningFile).Path
$env:EXPO_NO_TELEMETRY = '1'
$env:EXPO_OFFLINE = '1'
$env:NODE_ENV = 'production'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$temporary = Join-Path $buildRoot '.tools/tmp'
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
$env:TEMP = $temporary; $env:TMP = $temporary; $env:TMPDIR = $temporary
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$temporary -Djava.io.tmpdir=$temporary"
Push-Location $buildRoot
try {
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed.' }
    # Apply mods only. Expo prebuild can clear malformed folders even WITHOUT --clean.
    & node scripts/prebuild-android-safe.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed.' }
    $arguments = @('assembleRelease', '--offline', '--no-daemon', '--console=plain', '--no-parallel', '--max-workers=2',
        '-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m', '-Pkotlin.compiler.execution.strategy=in-process', '-PreactNativeArchitectures=arm64-v8a,x86_64')
    if ($DryRun) { $arguments += '--dry-run' }
    # cmd.exe gets a fixed executable/arguments, never any user path or secret interpolation.
    $command = '.\gradlew.bat ' + (($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    Invoke-BoundedDevelopmentProcess -Executable $env:ComSpec -Arguments ('/d /s /c "' + $command + '"') -WorkingDirectory (Join-Path $buildRoot 'android') -MobileRoot $mobileRoot -LogDirectory (Join-Path $buildRoot 'artifacts/release-build') -Budget $budget -PeakAdditionalBytes $PeakAdditionalBytes
    if ($Execute) {
        & (Join-Path $PSScriptRoot 'verify-android-apk.ps1') -ApkPath (Join-Path $buildRoot 'android/app/build/outputs/apk/release/app-release.apk') -Variant Release -ExpectedSignerSHA256 $signing.certificateSha256
    }
} finally { Pop-Location }
