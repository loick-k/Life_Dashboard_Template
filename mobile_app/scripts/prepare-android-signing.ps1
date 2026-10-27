param([string]$SigningDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'LifeDashboard/signing'))
$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path $PSScriptRoot -Parent
$signingRoot = [IO.Path]::GetFullPath($SigningDirectory)
$repositoryRoot = [IO.Path]::GetFullPath((Split-Path $mobileRoot -Parent))
if ($signingRoot.StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $signingRoot -eq $repositoryRoot) {
    throw 'Signing material must be outside the repository.'
}
$configuration = Join-Path $signingRoot 'signing.local.json'
if (Test-Path -LiteralPath $signingRoot) {
    if (-not (Test-Path -LiteralPath $configuration)) { throw 'Existing signing folder is incomplete. Preserve it; do not regenerate or overwrite a key.' }
    $saved = Get-Content -LiteralPath $configuration -Raw | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath $saved.storeFile)) { throw 'Existing signing key missing. Recover it from its private backup.' }
    [pscustomobject]@{ SigningFile = $configuration; CertificateSHA256 = $saved.certificateSha256; Created = $false }
    exit 0
}
$keytool = Join-Path $mobileRoot '.tools/jdk-17.0.20.1+1/bin/keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw 'Existing JDK required; this script never downloads tools.' }
New-Item -ItemType Directory -Path $signingRoot | Out-Null
# Restrict BEFORE writing secrets, not after. No inherited broad user access.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($identity)
foreach ($sid in @($identity, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
}
Set-Acl -LiteralPath $signingRoot -AclObject $acl
$random = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$password = [Convert]::ToBase64String($random)
$store = Join-Path $signingRoot 'life-dashboard-release.p12'
$certificate = Join-Path $signingRoot 'release.cer'
$previousPassword = $env:LIFE_DASHBOARD_KEYTOOL_PASSWORD
$env:LIFE_DASHBOARD_KEYTOOL_PASSWORD = $password
try {
    & $keytool -genkeypair -alias life-dashboard-release -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Life Dashboard V2' -storetype PKCS12 -keystore $store -storepass:env LIFE_DASHBOARD_KEYTOOL_PASSWORD -keypass:env LIFE_DASHBOARD_KEYTOOL_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Key generation failed; preserve the folder and investigate, never overwrite.' }
    & $keytool -exportcert -alias life-dashboard-release -keystore $store -storepass:env LIFE_DASHBOARD_KEYTOOL_PASSWORD -file $certificate
    if ($LASTEXITCODE -ne 0) { throw 'Certificate export failed; preserve the key.' }
    $fingerprint = (Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash
    $json = @{ storeFile = $store; storePassword = $password; keyAlias = 'life-dashboard-release'; keyPassword = $password; certificateSha256 = $fingerprint } | ConvertTo-Json
    [IO.File]::WriteAllText($configuration, $json, (New-Object Text.UTF8Encoding($false)))
    [pscustomobject]@{ SigningFile = $configuration; CertificateSHA256 = $fingerprint; Created = $true; Reminder = 'Back up this private folder securely outside Git. Losing it prevents compatible APK updates.' }
} finally { $env:LIFE_DASHBOARD_KEYTOOL_PASSWORD = $previousPassword; $password = $null; $json = $null }
