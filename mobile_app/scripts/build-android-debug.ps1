$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path $PSScriptRoot -Parent
$expectedMapping = "L:\: => $mobileRoot"
$existingMapping = @(subst.exe) | Where-Object { $_ -like 'L:\:*' }
if ($existingMapping) {
    if ($existingMapping.Trim() -ne $expectedMapping) { throw 'Drive L: belongs to another workspace. Do not overwrite it.' }
} elseif (Test-Path -LiteralPath 'L:\') {
    throw 'Drive L: already exists. Choose an unused build drive before continuing.'
} else {
    & subst.exe L: $mobileRoot
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create short build path.' }
}
# Reversible alias only: source files remain in the original repository.
$mobileRoot = 'L:\'
$env:JAVA_HOME = Join-Path $mobileRoot '.tools/jdk-17.0.20.1+1'
$env:ANDROID_HOME = Join-Path $mobileRoot '.tools/android-sdk'
$env:GRADLE_USER_HOME = Join-Path $mobileRoot '.tools/gradle-cache'
$env:EXPO_NO_TELEMETRY = '1'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$javaTmp = Join-Path $mobileRoot '.tools/tmp'
New-Item -ItemType Directory -Path $javaTmp -Force | Out-Null
# Windows AF_UNIX sockets used by Java selectors fail in some redirected temp paths.
# Scope these properties to this build process; do not change system temp/firewall.
$env:JAVA_TOOL_OPTIONS = "$env:JAVA_TOOL_OPTIONS -Djdk.net.unixdomain.tmpdir=$javaTmp -Djava.io.tmpdir=$javaTmp"
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
        & .\gradlew.bat assembleDebug --no-daemon --console=plain --no-parallel --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m' '-Pkotlin.compiler.execution.strategy=in-process' '-PreactNativeArchitectures=arm64-v8a,x86_64'
        if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    } finally { Pop-Location }
} finally { Pop-Location }
# Debug build only: NOT the signed standalone release required for delivery.
