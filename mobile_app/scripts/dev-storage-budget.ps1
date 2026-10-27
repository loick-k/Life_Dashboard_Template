# Shared by bounded local builds. Does not delete, download or reset the baseline.
function Get-CountedStorageGrowth {
    param([long]$PreviousBytes, [long]$PreviousCount, [long]$CurrentBytes)
    return $PreviousCount + [Math]::Max(0L, $CurrentBytes - $PreviousBytes)
}
function Get-DevelopmentStorageBudget {
    param([Parameter(Mandatory = $true)][string]$MobileRoot)
    $root = (Resolve-Path -LiteralPath $MobileRoot).Path
    $size = [long](Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction Stop | Measure-Object Length -Sum).Sum
    # Conservative allowance for Git metadata, signing (<10 KiB), npm logs and scan drift.
    $overhead = [long]100000000
    # 27/10: native regeneration + automatic tool cache maintenance reduced the
    # initial tree by ~3.4 GB. Reserve 4 GB conservatively, NOT a renewed budget.
    $replacedBaselineReserve = 4000000000L
    $growth = [Math]::Max(0L, $size - 11844623989L + $replacedBaselineReserve) + $overhead
    $ledgerFile = Join-Path $root '.tools/dev-storage-ledger.local.json'
    if (Test-Path -LiteralPath $ledgerFile) {
        try {
            $ledger = Get-Content -LiteralPath $ledgerFile -Raw | ConvertFrom-Json
            if ($ledger.policy -ne '2026-10-27-v1' -or
                ($ledger.lastBytes -isnot [long] -and $ledger.lastBytes -isnot [int]) -or
                ($ledger.countedBytes -isnot [long] -and $ledger.countedBytes -isnot [int]) -or
                $ledger.lastBytes -lt 0 -or $ledger.countedBytes -lt 100000000L) { throw 'Invalid ledger' }
            $growth = Get-CountedStorageGrowth -PreviousBytes $ledger.lastBytes -PreviousCount $ledger.countedBytes -CurrentBytes $size
        } catch { throw 'Disk ledger unreadable. Preserve it; do not reset the cumulative development budget.' }
    }
    # A reduction never renews the budget. Count every subsequently measured increase.
    $nextLedger = @{ policy = '2026-10-27-v1'; lastBytes = $size; countedBytes = $growth } | ConvertTo-Json
    $temporaryLedger = Join-Path $root ('.tools/dev-storage-ledger-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporaryLedger, $nextLedger, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporaryLedger -Destination $ledgerFile -Force
    [pscustomobject]@{
        MobileBytes = $size
        CountedGrowthBytes = $growth
        ReplacedBaselineReserveBytes = $replacedBaselineReserve
        LimitBytes = 5000000000L
        SafetyMarginBytes = 1000000000L
        AvailableDevelopmentBytes = [Math]::Max(0L, 4000000000L - $growth)
        FreeBytes = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($root)).AvailableFreeSpace
    }
}
function Assert-DevelopmentStoragePeak {
    param($Budget, [long]$PeakAdditionalBytes)
    if ($PeakAdditionalBytes -le 0) { throw 'Unknown peak: refusing to launch a heavy operation.' }
    if ($PeakAdditionalBytes -gt $Budget.AvailableDevelopmentBytes -or $PeakAdditionalBytes + 1000000000L -gt $Budget.FreeBytes) {
        throw 'Estimated peak exceeds the cumulative 5 GB budget or free-space margin. Nothing was started.'
    }
}
function Invoke-BoundedDevelopmentProcess {
    param([string]$Executable, [string]$Arguments, [string]$WorkingDirectory, [string]$MobileRoot,
        [string]$LogDirectory, $Budget, [long]$PeakAdditionalBytes)
    Assert-DevelopmentStoragePeak -Budget $Budget -PeakAdditionalBytes $PeakAdditionalBytes
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
    $runId = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
    $stdout = Join-Path $LogDirectory "$runId.out.log"; $stderr = Join-Path $LogDirectory "$runId.err.log"
    $startFree = [IO.DriveInfo]::new('C:\').AvailableFreeSpace
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    Write-Output "Process PID $($process.Id). Logs: $stdout ; $stderr"
    try {
        $checks = 0
        while (-not $process.WaitForExit(5000)) {
            $free = [IO.DriveInfo]::new('C:\').AvailableFreeSpace
            $loss = [Math]::Max(0L, $startFree - $free)
            $checks++
            $overBudget = $loss -gt $PeakAdditionalBytes -or $Budget.CountedGrowthBytes + $loss -gt 4000000000L -or $free -lt 1000000000L
            if ($checks % 6 -eq 0) {
                $current = Get-DevelopmentStorageBudget -MobileRoot $MobileRoot
                $overBudget = $overBudget -or $current.CountedGrowthBytes -gt 4000000000L -or $current.MobileBytes - $Budget.MobileBytes -gt $PeakAdditionalBytes
            }
            if ($overBudget) { throw 'Safety threshold reached. Stopping this process tree; no files deleted.' }
        }
        $process.Refresh()
        Get-Content -LiteralPath $stdout -Tail 25
        if ($process.ExitCode -ne 0) { Get-Content -LiteralPath $stderr -Tail 15; throw 'Development operation failed. No download or fallback is attempted.' }
        $current = Get-DevelopmentStorageBudget -MobileRoot $MobileRoot
        if ($current.CountedGrowthBytes -gt 4000000000L -or $current.MobileBytes - $Budget.MobileBytes -gt $PeakAdditionalBytes) { throw 'Final disk check exceeded the safety threshold; do not launch another operation.' }
        $current | Format-List
    } finally {
        # Also stop on scan failure/interruption, not only an explicit threshold event.
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
        $process.Dispose()
    }
}
