# Dismisses the Riot Client window while a Riot game is running, and for a short
# while after it exits (Riot re-opens the window then). Closes only the Riot
# Client UI; RiotClientServices, Vanguard and the game are left alone.
$ErrorActionPreference = 'Stop'

$gameProcesses = 'League of Legends', 'LeagueClientUx', 'VALORANT-Win64-Shipping'
$uiProcess = 'Riot Client'
$afterGameSeconds = 30
$forceAfterSeconds = 3

$created = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\RiotClientAutoClose', [ref]$created)
if (-not $created) { return }

$lastGameSeen = [datetime]::MinValue
$closeRequested = @{} # pid -> when CloseMainWindow was sent

try {
    while ($true) {
        if (Get-Process -Name $gameProcesses -ErrorAction SilentlyContinue) {
            $lastGameSeen = [datetime]::UtcNow
        }
        $active = ([datetime]::UtcNow - $lastGameSeen).TotalSeconds -le $afterGameSeconds

        $ui = @(Get-Process -Name $uiProcess -ErrorAction SilentlyContinue)
        foreach ($id in @($closeRequested.Keys)) {
            if ($id -notin $ui.Id) { $closeRequested.Remove($id) }
        }

        foreach ($process in $ui) {
            if ($process.MainWindowHandle -eq 0) {
                # Hidden to the tray; a later re-show is a new appearance.
                $closeRequested.Remove($process.Id)
            } elseif ($active -and -not $closeRequested.ContainsKey($process.Id)) {
                $null = $process.CloseMainWindow()
                $closeRequested[$process.Id] = [datetime]::UtcNow
            } elseif ($closeRequested.ContainsKey($process.Id) -and
                ([datetime]::UtcNow - $closeRequested[$process.Id]).TotalSeconds -ge $forceAfterSeconds) {
                Stop-Process -Name $uiProcess -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Seconds 1
    }
} finally {
    $mutex.ReleaseMutex()
}
