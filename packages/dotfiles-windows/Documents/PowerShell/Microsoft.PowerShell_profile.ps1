# Coding agents use their subscription auth, so direct provider API keys are
# removed for the duration of the call, and they run without permission
# prompts or a sandbox. Mirrors the fish wrappers in config.fish.tmpl.
function Invoke-AgentCli {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Flag,
        [object[]]$Arguments = @()
    )
    $exe = (Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $keyNames = @(
        ('ANTHROPIC', '_API_KEY' -join ''),
        ('OPENAI', '_API_KEY' -join ''),
        ('CODEX', '_API_KEY' -join '')
    )
    $saved = @{}
    foreach ($keyName in $keyNames) {
        $saved[$keyName] = [Environment]::GetEnvironmentVariable($keyName, 'Process')
        [Environment]::SetEnvironmentVariable($keyName, $null, 'Process')
    }
    try {
        & $exe $Flag @Arguments
    } finally {
        foreach ($keyName in $keyNames) {
            [Environment]::SetEnvironmentVariable($keyName, $saved[$keyName], 'Process')
        }
    }
}

function claude { Invoke-AgentCli -Name claude -Flag '--dangerously-skip-permissions' -Arguments $args }
function codex { Invoke-AgentCli -Name codex -Flag '--dangerously-bypass-approvals-and-sandbox' -Arguments $args }
