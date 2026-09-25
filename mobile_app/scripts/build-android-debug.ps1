$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path $PSScriptRoot -Parent
$env:JAVA_HOME = Join-Path $mobileRoot '.tools/jdk-17.0.20.1+1'
$env:ANDROID_HOME = Join-Path $mobileRoot '.tools/android-sdk'
$env:GRADLE_USER_HOME = Join-Path $mobileRoot '.tools/gradle-cache'
$env:EXPO_NO_TELEMETRY = '1'
if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) { throw 'Run install-android-tools.ps1 first.' }
Push-Location $mobileRoot
try {
    & npm.cmd run migrations:bundle
    if ($LASTEXITCODE -ne 0) { throw 'Migration bundle failed.' }
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed.' }
    if (-not (Test-Path -LiteralPath 'android/gradlew.bat')) {
        & npx.cmd expo prebuild --platform android --no-install
        if ($LASTEXITCODE -ne 0) { throw 'Android prebuild failed.' }
    }
    Push-Location android
    try {
        & .\gradlew.bat assembleDebug --no-daemon --console=plain '-PreactNativeArchitectures=arm64-v8a,x86_64'
        if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    } finally { Pop-Location }
} finally { Pop-Location }
# Debug build only: NOT the signed standalone release required for delivery.
