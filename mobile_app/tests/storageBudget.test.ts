import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('PowerShell build/signing/budget scripts parse without execution', () => {
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `
    $errorsFound = @()
    Get-ChildItem scripts/*release*.ps1,scripts/*signing*.ps1,scripts/dev-storage-budget.ps1,scripts/verify-standalone-bundle.ps1 | ForEach-Object {
      $tokens=$null; $errors=$null
      [void][Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors)
      $errorsFound += $errors
    }
    if ($errorsFound.Count) { exit 1 }
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('disk gate rejects unknown peaks, exhausted cumulative budget and inadequate free space', () => {
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `
    . ./scripts/dev-storage-budget.ps1
    if ((Get-CountedStorageGrowth -PreviousBytes 200 -PreviousCount 1000 -CurrentBytes 100) -ne 1000) { exit 5 }
    if ((Get-CountedStorageGrowth -PreviousBytes 100 -PreviousCount 1000 -CurrentBytes 150) -ne 1050) { exit 6 }
    $budget = [pscustomobject]@{ AvailableDevelopmentBytes=3000000000L; FreeBytes=10000000000L }
    Assert-DevelopmentStoragePeak -Budget $budget -PeakAdditionalBytes 500000000L
    foreach ($peak in @(-1L,0L,3000000001L)) {
      $refused=$false
      try { Assert-DevelopmentStoragePeak -Budget $budget -PeakAdditionalBytes $peak } catch { $refused=$true }
      if (-not $refused) { exit 2 }
    }
    $budget.FreeBytes=1200000000L
    try { Assert-DevelopmentStoragePeak -Budget $budget -PeakAdditionalBytes 500000000L; exit 3 } catch { }
    $budget.FreeBytes=10000000000L; $budget.AvailableDevelopmentBytes=0L
    try { Assert-DevelopmentStoragePeak -Budget $budget -PeakAdditionalBytes 1L; exit 4 } catch { }
    exit 0
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
