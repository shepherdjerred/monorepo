# Bootstrap a Windows PC from packages/dotfiles-windows. Safe to re-run.
# Run from PowerShell after cloning the monorepo to ~/Git/monorepo, or set
# DOTFILES_LOCAL_PATH to another checkout of this directory.
$ErrorActionPreference = 'Stop'

function Invoke-Native([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code ${LASTEXITCODE}: $Command" }
}

# Keep this script Windows PowerShell 5.1 compatible: a fresh install has no pwsh yet.
$source = if ($env:DOTFILES_LOCAL_PATH) { $env:DOTFILES_LOCAL_PATH } else { Join-Path $HOME 'Git\monorepo\packages\dotfiles-windows' }
$msys = 'C:\msys64'

# pwsh runs this source's .ps1 scripts (see .chezmoi.toml.tmpl), so it must exist before the apply.
foreach ($id in 'Git.Git', 'Microsoft.PowerShell', 'twpayne.chezmoi', 'MSYS2.MSYS2', 'AmanThanvi.winghostty') {
    winget install --id $id --exact --no-upgrade --accept-package-agreements --accept-source-agreements
    # 0x8A150061: already installed.
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335135) { throw "winget install $id failed with exit code $LASTEXITCODE" }
}
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

# MSYS2 fish shares the Windows home and PATH, so it reads the chezmoi-managed
# ~/.config/fish and finds native tools.
Invoke-Native { & "$msys\usr\bin\bash.exe" -lc 'pacman -S --needed --noconfirm fish' }
$nsswitch = "$msys\etc\nsswitch.conf"
(Get-Content $nsswitch) -replace '^db_home:.*$', 'db_home: windows' | Set-Content $nsswitch
[Environment]::SetEnvironmentVariable('MSYS2_PATH_TYPE', 'inherit', 'User')
$env:MSYS2_PATH_TYPE = 'inherit'

# chezmoi creates symlinks (~/.claude/CLAUDE.md, ~/.codex/AGENTS.md), which
# non-elevated processes may only do with Developer Mode on.
$devMode = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
if ((Get-ItemProperty $devMode -ErrorAction SilentlyContinue).AllowDevelopmentWithoutDevLicense -ne 1) {
    $p = Start-Process reg.exe -Verb RunAs -Wait -PassThru -ArgumentList 'add', 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock', '/v', 'AllowDevelopmentWithoutDevLicense', '/t', 'REG_DWORD', '/d', '1', '/f'
    if ($p.ExitCode -ne 0) { throw "Enabling Developer Mode failed with exit code $($p.ExitCode)" }
}

Invoke-Native { chezmoi init --apply --source $source }
Invoke-Native { mise install }

Invoke-Native { & "$msys\usr\bin\fish.exe" -lc 'type -q fisher; or begin; curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source; end; fisher update' }

# Inside WSL, packages/dotfiles/install.sh sets up the Linux side.
$env:WSL_UTF8 = '1'
if ((wsl --list --quiet) -notcontains 'Ubuntu-24.04') {
    Invoke-Native { wsl --install --no-launch -d Ubuntu-24.04 }
}
