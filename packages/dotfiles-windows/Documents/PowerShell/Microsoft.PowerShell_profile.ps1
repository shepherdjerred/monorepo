# Coding-agent wrappers, the Windows counterpart of agent-exec in
# packages/dotfiles/dot_local/share/agent-bin. Herdr starts its terminals in
# this shell, so menu launches get the same behavior as a typed command.
# Mirrored by the fish functions in config.fish.tmpl.
#
# - Agents use their subscription login: direct provider API keys and the
#   homelab service tokens are removed for the duration of the call.
# - Agents run with approvals and sandboxing bypassed. AGENT_SAFE=1 drops the
#   bypass flags for one run; the environment is still scrubbed.
# - Agents never wait on an editor or pager.
$script:AgentScrubbed = @(
    @('ANTHROPIC', 'OPENAI', 'CODEX', 'GEMINI', 'GOOGLE', 'XAI', 'GROK', 'MOONSHOT', 'KIMI', 'CURSOR') |
        ForEach-Object { $_, '_API_KEY' -join '' }
) + @(
    'OP_SERVICE_ACCOUNT_TOKEN', 'BUGSINK_TOKEN', ('GRAFANA', '_API_KEY' -join ''), 'DISCORD_USER_TOKEN',
    'DISCORD_BOT_TOKEN', ('POSTHOG_CLI', '_API_KEY' -join ''), 'ARGOCD_AUTH_TOKEN', 'WOODPECKER_TOKEN',
    'CF_API_TOKEN', 'CLOUDFLARE_API_TOKEN'
)

function Invoke-AgentCli {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string[]]$Bypass = @(),
        [string[]]$Extra = @(),
        [object[]]$Arguments = @()
    )
    $exe = (Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    # Git for Windows ships the no-op; `true` itself is not on the Windows PATH.
    $gitRoot = Split-Path (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    while ($gitRoot -and -not (Test-Path (Join-Path $gitRoot 'usr\bin\true.exe'))) { $gitRoot = Split-Path $gitRoot }
    if (-not $gitRoot) { throw 'usr\bin\true.exe from Git for Windows was not found above git.exe' }
    $noEditor = '"{0}"' -f (Join-Path $gitRoot 'usr\bin\true.exe')
    $set = @{
        EDITOR = $noEditor; VISUAL = $noEditor; GIT_EDITOR = $noEditor
        PAGER = 'cat'; GIT_PAGER = 'cat'
    }
    $flags = @(if ($env:AGENT_SAFE -ne '1') { $Bypass })
    $saved = @{}
    foreach ($key in @($script:AgentScrubbed) + @($set.Keys)) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $set[$key], 'Process')
    }
    try {
        & $exe @flags @Extra @Arguments
    } finally {
        foreach ($key in $saved.Keys) {
            [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
        }
    }
}

# A wrapper exists only where its agent is installed, so Herdr's agent menu
# lists what can actually start. `agent` stays unwrapped: here it is Grok's.
$agentBypass = [ordered]@{
    claude         = @('--dangerously-skip-permissions')
    codex          = @('--dangerously-bypass-approvals-and-sandbox')
    agy            = @('--dangerously-skip-permissions')
    'cursor-agent' = @('--yolo', '--sandbox', 'disabled')
    grok           = @('--always-approve')
    kimi           = @('--auto')
    muse           = @('--yolo', '--disable-sandbox')
}
foreach ($agent in $agentBypass.Keys) {
    if (-not (Get-Command $agent -CommandType Application -ErrorAction SilentlyContinue)) { continue }
    $bypass = $agentBypass[$agent]
    if ($agent -eq 'codex') {
        # Herdr requires --no-daemon so Codex runs its commands inside hc, and a
        # running Codex never follows the light/dark switch (openai/codex#45163),
        # so each launch picks the matching theme. Neither is a bypass flag, so
        # both survive AGENT_SAFE=1.
        $body = {
            $light = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction Stop).AppsUseLightTheme
            $theme = if ($light -eq 0) { 'catppuccin-mocha' } else { 'catppuccin-latte' }
            $extra = @(if ($args -notcontains '--no-daemon') { '--no-daemon' }) + @('-c', "tui.theme=`"$theme`"")
            Invoke-AgentCli -Name codex -Bypass $bypass -Extra $extra -Arguments $args
        }.GetNewClosure()
    } else {
        $body = { Invoke-AgentCli -Name $agent -Bypass $bypass -Arguments $args }.GetNewClosure()
    }
    Set-Item -Path "function:global:$agent" -Value $body
}
Remove-Variable agentBypass, agent, bypass, body -ErrorAction SilentlyContinue

# `agent-safe <agent> [args...]`: the counterpart of `env AGENT_SAFE=1 <agent>`,
# which Herdr's argv cannot express here. The new-worktree dialog starts
# plan-style modes this way.
function agent-safe {
    $command = $args[0]
    $rest = @($args | Select-Object -Skip 1)
    $saved = $env:AGENT_SAFE
    $env:AGENT_SAFE = '1'
    try {
        & $command @rest
    } finally {
        $env:AGENT_SAFE = $saved
    }
}
