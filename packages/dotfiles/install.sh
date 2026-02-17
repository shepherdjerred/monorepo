#!/bin/bash

set -Eeuo pipefail
# Enable xtrace only when TRACE=1
if [[ "${TRACE:-0}" == "1" ]]; then set -x; fi

export NONINTERACTIVE=1
export DEBIAN_FRONTEND=noninteractive
export APT_LISTCHANGES_FRONTEND=none

# --- logging helpers ---
timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log_info() { printf "[%s] [INFO] %s\n" "$(timestamp)" "$*"; }
log_warn() { printf "[%s] [WARN] %s\n" "$(timestamp)" "$*" 1>&2; }
log_error() { printf "[%s] [ERROR] %s\n" "$(timestamp)" "$*" 1>&2; }
log_success() { printf "[%s] [OK] %s\n" "$(timestamp)" "$*"; }

# --- run metadata & diagnostics ---
START_TIME_EPOCH="$(date -u +%s)"
START_TIME_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
LOG_DIR="/var/lib/dotfiles"
LOG_FILE=""
STATUS_JSON=""
SYSTEM_INFO_FILE=""
LAST_ERROR_LINE=""
LAST_ERROR_CMD=""

# --- retry helper ---
retry() {
    local max_attempts="${1:-5}"
    shift || true
    local sleep_seconds="${1:-2}"
    shift || true
    local attempt=1
    while true; do
        if "$@"; then
            return 0
        fi
        if ((attempt >= max_attempts)); then
            log_error "Command failed after ${attempt} attempts: $*"
            return 1
        fi
        log_warn "Attempt ${attempt} failed for: $*; retrying in ${sleep_seconds}s"
        attempt=$((attempt + 1))
        sleep "${sleep_seconds}"
    done
}

# --- error trap ---
on_error() {
    local exit_code=$?
    local line_no=${BASH_LINENO[0]:-unknown}
    LAST_ERROR_LINE="${line_no}"
    LAST_ERROR_CMD="${BASH_COMMAND}"
    log_error "Exited with status ${exit_code} at line ${line_no}. Last command: ${BASH_COMMAND}"
}
trap on_error ERR

# Logging, run metadata, and diagnostics will be initialized after privilege escalation

# Idempotency marker: skip if a successful run already completed
INSTALL_MARKER="/var/lib/dotfiles/install_success"
if [ -f "$INSTALL_MARKER" ]; then
    log_info "Install script already completed successfully; skipping."
    exit 0
fi

# --- initialize logging to /var/lib/dotfiles ---
# Create log directory with sudo, then set ownership to current user
sudo mkdir -p "${LOG_DIR}"
sudo chown "$(id -u):$(id -g)" "${LOG_DIR}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)$$"
LOG_FILE="${LOG_DIR}/install_${RUN_ID}.log"
STATUS_JSON="${LOG_DIR}/status_${RUN_ID}.json"
SYSTEM_INFO_FILE="${LOG_DIR}/system_info_${RUN_ID}.txt"

# Symlinks for convenience
ln -sfn "${LOG_FILE}" "${LOG_DIR}/install_latest.log"
ln -sfn "${STATUS_JSON}" "${LOG_DIR}/status_latest.json"

# Route stdout and stderr through tee to log file
exec > >(tee -a "${LOG_FILE}") 2>&1

# Improve xtrace formatting when enabled
if [[ "${TRACE:-0}" == "1" ]]; then
    # Prefix xtrace lines similarly to our logger with timestamp and TRACE tag
    export PS4='+ [$(date -u +%Y-%m-%dT%H:%M:%SZ)] [TRACE] ${BASH_SOURCE}:${LINENO}: '
    set -x
fi

log_info "Starting dotfiles install"

# Capture system info snapshot (avoid dumping sensitive envs)
{
    echo "==== SYSTEM INFO (${START_TIME_ISO}) ===="
    echo "Kernel: $(uname -a)"
    echo "OS release:"; (cat /etc/os-release 2>/dev/null || true)
    echo
    echo "Users: $(id -a)"
    echo "Shell: ${SHELL:-unknown}"
    echo "PATH: ${PATH}"
    echo
    echo "Disk usage:"; df -h 2>/dev/null || true
    echo
    echo "Memory:"; free -h 2>/dev/null || true
    echo
    echo "Network:"; (ip a 2>/dev/null || true)
    echo
    echo "Environment (safe subset):"
    env | grep -E '^(CI|CODESPACES|GITHUB|HOME|LANG|LC_|LOGNAME|PATH|PWD|SHELL|SHLVL|TERM|TZ|USER)=' || true
} > "${SYSTEM_INFO_FILE}" 2>/dev/null || true

# Write an initial status file; final status written on EXIT
write_status_json() {
    local final_status="$1"  # "running", "success", or "error"
    local end_time_epoch
    end_time_epoch="$(date -u +%s)"
    local end_time_iso
    end_time_iso="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    local last_error_line_json
    local last_error_cmd_json
    if [ -n "${LAST_ERROR_LINE}" ]; then
        last_error_line_json=", \"last_error_line\": ${LAST_ERROR_LINE}"
    else
        last_error_line_json=""
    fi
    if [ -n "${LAST_ERROR_CMD}" ]; then
        # Escape backslashes and quotes in command for JSON
        local esc
        esc="$(printf '%s' "${LAST_ERROR_CMD}" | sed 's/\\/\\\\/g; s/\"/\\\"/g')"
        last_error_cmd_json=", \"last_error_command\": \"${esc}\""
    else
        last_error_cmd_json=""
    fi
    cat > "${STATUS_JSON}" <<EOF
{
  "run_id": "${RUN_ID}",
  "start_time_iso": "${START_TIME_ISO}",
  "start_time_epoch": ${START_TIME_EPOCH},
  "end_time_iso": "${end_time_iso}",
  "end_time_epoch": ${end_time_epoch},
  "status": "${final_status}",
  "log_file": "${LOG_FILE}",
  "system_info_file": "${SYSTEM_INFO_FILE}"${last_error_line_json}${last_error_cmd_json}
}
EOF
}

# Ensure status is written on any exit
on_exit_write_status() {
    local exit_code=$?
    if [ $exit_code -eq 0 ]; then
        write_status_json "success"
    else
        write_status_json "error"
    fi
}
trap on_exit_write_status EXIT

retry 5 3 sudo apt-get -yq update
retry 5 3 sudo apt-get -yq install build-essential procps curl file git \
    libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev \
    libffi-dev liblzma-dev libncursesw5-dev xz-utils tk-dev

# install linuxbrew
# Create .dockerenv to trick Homebrew into CI mode (skips some interactive prompts)
sudo touch /.dockerenv
{
    tmpfile="$(mktemp)"
    retry 5 3 curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$tmpfile"
    /bin/bash "$tmpfile"
    rm -f "$tmpfile"
} || log_warn "Homebrew install script encountered an error"

(
    echo
    # shellcheck disable=SC2016 # Intentionally single-quoted: written literally to .bashrc
    echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"'
) >>~/.bashrc
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

if command -v brew >/dev/null 2>&1; then
    retry 5 3 brew install -q chezmoi
else
    log_error "brew not found after installation"
fi

# configure
# allow failure; codespaces won't have access to secrets
# Use local dotfiles if DOTFILES_LOCAL_PATH is set, otherwise clone from GitHub
if [ -n "${DOTFILES_LOCAL_PATH:-}" ] && [ -d "${DOTFILES_LOCAL_PATH}" ]; then
    log_info "Using local dotfiles from: ${DOTFILES_LOCAL_PATH}"
    chezmoi init --apply "${DOTFILES_LOCAL_PATH}" --keep-going || true
else
    log_info "Cloning dotfiles from GitHub"
    chezmoi init --apply https://github.com/shepherdjerred/dotfiles --keep-going || true
fi

# install Brewfile
if command -v brew >/dev/null 2>&1; then
    (cd ~ && retry 3 5 brew bundle --file=.Brewfile)
else
    log_warn "Skipping brew bundle: brew not available"
fi

# install languages
if command -v mise >/dev/null 2>&1; then
    retry 3 5 mise install --yes
else
    log_warn "Skipping mise install: mise not available"
fi

# install fisher
if command -v fish >/dev/null 2>&1; then
    fish -c "curl -fsSL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher"
    chezmoi apply --force --exclude templates && fish -c "fisher update"
else
    log_warn "Skipping fisher install/update: fish not available"
fi

# install lunarvim
# note: say no to the python install question; we install this manually
# todo: automate these selections
# manual step: setup copilot with :Copilot auth
if ! command -v lvim &>/dev/null; then
    LV_BRANCH='release-1.4/neovim-0.9' fish -c "bash -c 'bash <(curl -fsSL https://raw.githubusercontent.com/LunarVim/LunarVim/release-1.4/neovim-0.9/utils/installer/install.sh)' --no-install-dependencies" || log_warn "LunarVim install skipped or failed"
fi

# setup atuin
if command -v atuin >/dev/null 2>&1; then
    # Determine login status without failing the script under 'set -e'
    set +e
    atuin status >/dev/null 2>&1
    ATUIN_LOGGED_IN=$?
    set -e

    if [ "$ATUIN_LOGGED_IN" -ne 0 ]; then
        # TODO: make non-interactive
        atuin login -u sjerred || true
        # Re-check status after login attempt
        set +e
        atuin status >/dev/null 2>&1
        ATUIN_LOGGED_IN=$?
        set -e
    fi

    # Only import if bash history file exists
    if [ -f "$HOME/.bash_history" ]; then
        atuin import auto || true
    fi

    if [ "$ATUIN_LOGGED_IN" -eq 0 ]; then
        atuin sync || true
    fi
fi

# tmux
# note: must run `prefix + I` to install plugins
# note: must run through fish to use the updated tmux
if [ ! -d "$HOME/.tmux/plugins/tpm" ]; then
    git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
fi

# bat
if command -v bat >/dev/null 2>&1; then
    theme_dir="$(bat --config-dir)/themes"
    mkdir -p "${theme_dir}"
    retry 3 3 curl -fsSL -o "${theme_dir}/Catppuccin Latte.tmTheme" https://github.com/catppuccin/bat/raw/main/themes/Catppuccin%20Latte.tmTheme
    retry 3 3 curl -fsSL -o "${theme_dir}/Catppuccin Frappe.tmTheme" https://github.com/catppuccin/bat/raw/main/themes/Catppuccin%20Frappe.tmTheme
    retry 3 3 curl -fsSL -o "${theme_dir}/Catppuccin Macchiato.tmTheme" https://github.com/catppuccin/bat/raw/main/themes/Catppuccin%20Macchiato.tmTheme
    retry 3 3 curl -fsSL -o "${theme_dir}/Catppuccin Mocha.tmTheme" https://github.com/catppuccin/bat/raw/main/themes/Catppuccin%20Mocha.tmTheme
    bat cache --build || log_warn "bat cache rebuild failed"
else
    log_warn "Skipping bat theme setup: bat not available"
fi

# delta
mkdir -p ~/.config/delta
if [ ! -d "$HOME/.config/delta/themes" ]; then
    git clone https://github.com/catppuccin/delta ~/.config/delta/themes || log_warn "delta themes clone failed"
fi

# add fish to /etc/shells
if ! grep -qx "/home/linuxbrew/.linuxbrew/bin/fish" /etc/shells; then
    echo /home/linuxbrew/.linuxbrew/bin/fish | sudo tee -a /etc/shells >/dev/null
fi

# git credential manager
if ! command -v git-credential-manager >/dev/null 2>&1; then
    log_info "Installing Git Credential Manager"
    tmpfile="$(mktemp)"
    if retry 3 5 curl -fsSL https://aka.ms/gcm/linux-install-source.sh -o "$tmpfile"; then
        bash "$tmpfile" -y || log_warn "GCM install script failed"
    else
        log_warn "Failed to download GCM install script"
    fi
    rm -f "$tmpfile"
fi
if command -v git-credential-manager >/dev/null 2>&1; then
    log_info "GCM configured"
    # git-credential-manager configure || log_warn "GCM configure failed"
    # git config --global credential.credentialStore cache
    # git config --global credential.cacheOptions "--timeout 43200" # 12 hours
else
    log_warn "GCM unavailable; skipping configuration"
fi

# remove bash/zsh files, history, etc
rm -rf ~/.bash_history ~/.bash_logout ~/.zsh_history ~/.zshrc

# Mark successful completion so subsequent runs are no-ops
sudo mkdir -p /var/lib/dotfiles
sudo touch "$INSTALL_MARKER"
log_success "Dotfiles install completed"

# Also update status file to success explicitly at the very end
write_status_json "success" || true
