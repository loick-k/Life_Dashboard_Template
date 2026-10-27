param(
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [ValidateSet('Debug', 'Release')][string]$Variant = 'Release',
    [string]$ExpectedSignerSHA256
)
$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path $PSScriptRoot -Parent
$buildTools = Join-Path $mobileRoot '.tools/android-sdk/build-tools/36.0.0'
$apk = (Resolve-Path -LiteralPath $ApkPath).Path
$previousJavaHome = $env:JAVA_HOME
$env:JAVA_HOME = Join-Path $mobileRoot '.tools/jdk-17.0.20.1+1'
try {
    $signature = & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $apk 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $certificate = [regex]::Matches(($signature -join "`n"), '(?m)^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)\s*$')
    $badging = & (Join-Path $buildTools 'aapt.exe') dump badging $apk
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect APK metadata.' }
    $manifest = & (Join-Path $buildTools 'aapt.exe') dump xmltree $apk AndroidManifest.xml
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect packaged manifest.' }
    $metadata = $badging -join "`n"
    $xml = $manifest -join "`n"
    if ($metadata -notmatch "package: name='app.lifedashboard.mobile'") { throw 'Unexpected application ID.' }
    if ($xml -notmatch 'android:allowBackup\([^\r\n]+\)=\(type 0x12\)0x0') { throw 'Automatic backup must be disabled.' }
    if ($metadata -match "uses-permission: name='android.permission.(READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE)'") {
        throw 'Broad external storage permission is forbidden.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $names = @($archive.Entries.FullName)
        foreach ($abi in @('arm64-v8a', 'x86_64')) {
            if ($names -notcontains "lib/$abi/libexpo-sqlite.so") { throw "Missing SQLite native module for $abi." }
        }
        $hasBundle = $names -contains 'assets/index.android.bundle'
    } finally { $archive.Dispose() }
    if ($Variant -eq 'Release') {
        if ($ExpectedSignerSHA256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Expected release certificate SHA256 required, from the private signing configuration.' }
        if ($certificate.Count -ne 1 -or $certificate[0].Groups[1].Value -ne $ExpectedSignerSHA256) { throw 'Unexpected release signer. Do not install this APK as an update.' }
        if (($signature -join "`n") -match 'CN=Android Debug') { throw 'Release must not use the debug certificate.' }
        if ($metadata -notmatch "uses-permission: name='android.permission.USE_BIOMETRIC'") { throw 'Biometric permission missing from release APK.' }
        if ($metadata -match 'application-debuggable') { throw 'Release APK is debuggable.' }
        if ($metadata -match "uses-permission: name='android.permission.SYSTEM_ALERT_WINDOW'") { throw 'Release APK requests overlay permission.' }
        if ($xml -match 'android:usesCleartextTraffic\([^\r\n]+\)=\(type 0x12\)0xffffffff') { throw 'Release APK permits cleartext traffic.' }
        if (-not $hasBundle) { throw 'Release APK has no embedded JavaScript bundle.' }
    }
    [PSCustomObject]@{
        Apk = $apk
        Variant = $Variant
        Bytes = (Get-Item -LiteralPath $apk).Length
        SHA256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
        EmbeddedJavaScript = $hasBundle
        SignatureVerified = $true
        ExpectedSignerMatched = ($Variant -eq 'Release')
        Metadata = @($badging | Where-Object { $_ -match '^(package:|sdkVersion:|targetSdkVersion:|native-code:)' })
        Limitation = 'Static artifact checks only: no proof of runtime encryption, functional parity or Android usability. Back up the signing key for update continuity.'
    } | ConvertTo-Json -Depth 3
} finally { $env:JAVA_HOME = $previousJavaHome }
