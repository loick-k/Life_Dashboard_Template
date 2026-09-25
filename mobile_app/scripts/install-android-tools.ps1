$ErrorActionPreference = 'Stop'
$toolsRoot = Join-Path (Split-Path $PSScriptRoot -Parent) '.tools'
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null

function Get-VerifiedArchive($Url, $Name, $Algorithm, $Checksum) {
    $archivePath = Join-Path $toolsRoot $Name
    if (-not (Test-Path -LiteralPath $archivePath)) {
        & curl.exe --fail --location --retry 2 --output $archivePath $Url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Name" }
    }
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm $Algorithm).Hash.ToLowerInvariant() -ne $Checksum) {
        throw "Archive checksum mismatch: $Name. No extraction performed."
    }
    return $archivePath
}

$jdkArchive = Get-VerifiedArchive 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip' 'jdk17.zip' 'SHA256' 'e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0'
$jdkDirectory = Join-Path $toolsRoot 'jdk-17.0.20.1+1'
if (-not (Test-Path -LiteralPath (Join-Path $jdkDirectory 'bin/java.exe'))) {
    Expand-Archive -LiteralPath $jdkArchive -DestinationPath $toolsRoot
}

$sdkArchive = Get-VerifiedArchive 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip' 'android-cli23.zip' 'SHA1' '57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d'
$sdkExtract = Join-Path $toolsRoot 'android-cli23'
if (-not (Test-Path -LiteralPath (Join-Path $sdkExtract 'cmdline-tools/bin/sdkmanager.bat'))) {
    Expand-Archive -LiteralPath $sdkArchive -DestinationPath $sdkExtract
}
Write-Output "Local tools prepared under $toolsRoot. SDK packages and licenses still required."
