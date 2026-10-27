$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'dev-storage-budget.ps1')
$budget = Get-DevelopmentStorageBudget -MobileRoot $mobileRoot
# Metro transforms + Hermes output, no native compilation, SDK install or npm install.
Assert-DevelopmentStoragePeak -Budget $budget -PeakAdditionalBytes 500000000L
$temporary = Join-Path $mobileRoot '.tools/tmp'
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
$env:TEMP = $temporary; $env:TMP = $temporary; $env:TMPDIR = $temporary
$env:EXPO_OFFLINE = '1'; $env:EXPO_NO_TELEMETRY = '1'; $env:NODE_ENV = 'production'
$output = Join-Path $mobileRoot ('artifacts/standalone-bundle/' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $output | Out-Null
$bundle = Join-Path $output 'index.android.bundle'
$arguments = '"node_modules/expo/bin/cli" export:embed --entry-file index.ts --platform android --dev false --bytecode --max-workers 2 --bundle-output "' + $bundle + '" --assets-dest "' + (Join-Path $output 'assets') + '"'
Invoke-BoundedDevelopmentProcess -Executable (Get-Command node.exe).Source -Arguments $arguments -WorkingDirectory $mobileRoot -MobileRoot $mobileRoot -LogDirectory $output -Budget $budget -PeakAdditionalBytes 500000000L
if (-not (Test-Path -LiteralPath $bundle) -or (Get-Item -LiteralPath $bundle).Length -eq 0) { throw 'Standalone bundle missing.' }
$reader = [IO.BinaryReader]::new([IO.File]::OpenRead($bundle))
try { $magic = [Convert]::ToHexString($reader.ReadBytes(8)) } finally { $reader.Dispose() }
if ($magic -ne 'C61FBC03C103191F') { throw 'Expected Hermes bytecode, not a development JavaScript bundle.' }
[pscustomobject]@{ Bundle = $bundle; Bytes = (Get-Item -LiteralPath $bundle).Length; SHA256 = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash; Limitation = 'Production Hermes bundle only; not an APK and not a native runtime validation.' } | Format-List
