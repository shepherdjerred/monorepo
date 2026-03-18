#!/bin/bash

set -Eeuo pipefail
if [[ "${TRACE:-0}" == "1" ]]; then set -x; fi

# --- logging helpers ---
timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log_info() { printf "[%s] [INFO] %s\n" "$(timestamp)" "$*"; }
log_warn() { printf "[%s] [WARN] %s\n" "$(timestamp)" "$*" 1>&2; }
log_error() { printf "[%s] [ERROR] %s\n" "$(timestamp)" "$*" 1>&2; }
log_success() { printf "[%s] [OK] %s\n" "$(timestamp)" "$*"; }

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

log_info "Starting macOS dotfiles install"

# Install Xcode Command Line Tools if not present
if ! xcode-select -p &>/dev/null; then
    log_info "Installing Xcode Command Line Tools"
    xcode-select --install
    log_info "Waiting for Xcode CLT installation to complete..."
    until xcode-select -p &>/dev/null; do
        sleep 5
    done
    log_success "Xcode CLT installed"
else
    log_info "Xcode CLT already installed"
fi

# Install Homebrew if not present
if ! command -v brew &>/dev/null; then
    log_info "Installing Homebrew"
    tmpfile="$(mktemp)"
    retry 5 3 curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$tmpfile"
    /bin/bash "$tmpfile"
    rm -f "$tmpfile"
    eval "$(/opt/homebrew/bin/brew shellenv)"
    log_success "Homebrew installed"
else
    log_info "Homebrew already installed"
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Install chezmoi first
if ! command -v chezmoi &>/dev/null; then
    log_info "Installing chezmoi"
    retry 5 3 brew install -q chezmoi
fi

# Apply dotfiles
if [ -n "${DOTFILES_LOCAL_PATH:-}" ] && [ -d "${DOTFILES_LOCAL_PATH}" ]; then
    log_info "Using local dotfiles from: ${DOTFILES_LOCAL_PATH}"
    chezmoi init --source "${DOTFILES_LOCAL_PATH}" --apply --keep-going || true
else
    log_info "Cloning dotfiles from GitHub"
    chezmoi init --apply https://github.com/shepherdjerred/dotfiles --keep-going || true
fi

# Install Brewfile
if command -v brew &>/dev/null; then
    log_info "Installing Brewfile packages"
    (cd ~ && retry 3 5 brew bundle --file=.Brewfile)
    log_success "Brewfile packages installed"

    # Re-apply chezmoi now that whiskers and other tools are available
    log_info "Re-applying chezmoi templates (post-brew)"
    chezmoi apply --keep-going || true

    # Apply macOS app defaults (run_onchange won't re-trigger since hashes unchanged)
    if command -v macos-defaults &>/dev/null && [ -d "$HOME/.config/macos-defaults" ]; then
        log_info "Applying macOS app defaults"
        macos-defaults apply ~/.config/macos-defaults/ || log_warn "macos-defaults apply failed"
    fi
else
    log_warn "Skipping brew bundle: brew not available"
fi

# Open apps that need manual Gatekeeper approval.
# These are unsigned or ad-hoc signed apps from Homebrew that macOS blocks on first launch.
# The user must click "Open Anyway" in System Settings > Privacy & Security for each.
log_info "Opening apps that need Gatekeeper approval..."
log_info "If prompted, go to System Settings > Privacy & Security and click 'Open Anyway'"
# Syntax Highlight: Quick Look extension for code syntax highlighting (unsigned Homebrew cask)
open "/Applications/Syntax Highlight.app" 2>/dev/null || true
# QLMarkdown: Quick Look extension for Markdown rendering (unsigned Homebrew cask)
open "/Applications/QLMarkdown.app" 2>/dev/null || true

# Install language runtimes via mise
if command -v mise &>/dev/null; then
    log_info "Installing language runtimes via mise"
    retry 3 5 mise install --yes
    log_success "Mise runtimes installed"
else
    log_warn "Skipping mise install: mise not available"
fi

# Install Fisher (fish plugin manager)
if command -v fish &>/dev/null; then
    log_info "Installing Fisher and fish plugins"
    fish -c "curl -fsSL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher"
    chezmoi apply --force --exclude templates && fish -c "fisher update"
    log_success "Fisher and plugins installed"
else
    log_warn "Skipping fisher install: fish not available"
fi

# Neovim: install plugins, LSP servers, and tree-sitter parsers
if command -v nvim &>/dev/null; then
    log_info "Installing Neovim plugins"
    nvim --headless "+Lazy! sync" +qa
    log_info "Installing tree-sitter parsers"
    nvim --headless "+TSUpdateSync" +qa
    log_success "Neovim setup complete"
else
    log_warn "Skipping Neovim setup: nvim not available"
fi

# Setup Atuin
if command -v atuin &>/dev/null; then
    log_info "Setting up Atuin"
    set +e
    atuin status &>/dev/null
    ATUIN_LOGGED_IN=$?
    set -e

    if [ "$ATUIN_LOGGED_IN" -ne 0 ]; then
        atuin login -u sjerred || true
        set +e
        atuin status &>/dev/null
        ATUIN_LOGGED_IN=$?
        set -e
    fi

    if [ "$ATUIN_LOGGED_IN" -eq 0 ]; then
        atuin sync || true
    fi
    log_success "Atuin configured"
fi

# Bat themes
if command -v bat &>/dev/null; then
    log_info "Installing bat Catppuccin themes"
    theme_dir="$(bat --config-dir)/themes"
    mkdir -p "${theme_dir}"
    retry 3 3 curl -fsSL -o "${theme_dir}/Catppuccin Latte.tmTheme" https://github.com/catppuccin/bat/raw/main/themes/Catppuccin%20Latte.tmTheme
    retry 3 3 curl -fsSL -o "${theme_dir}/Catppuccin Frappe.tmTheme" https://github.com/catppuccin/bat/raw/main/themes/Catppuccin%20Frappe.tmTheme
    retry 3 3 curl -fsSL -o "${theme_dir}/Catppuccin Macchiato.tmTheme" https://github.com/catppuccin/bat/raw/main/themes/Catppuccin%20Macchiato.tmTheme
    retry 3 3 curl -fsSL -o "${theme_dir}/Catppuccin Mocha.tmTheme" https://github.com/catppuccin/bat/raw/main/themes/Catppuccin%20Mocha.tmTheme
    bat cache --build || log_warn "bat cache rebuild failed"
    log_success "Bat themes installed"
fi

# Delta themes — managed by chezmoi (private_dot_config/delta/themes/catppuccin.gitconfig)

# Add fish to /etc/shells and set as default
if command -v fish &>/dev/null; then
    FISH_PATH="$(which fish)"
    if ! grep -qx "${FISH_PATH}" /etc/shells; then
        log_info "Adding fish to /etc/shells"
        echo "${FISH_PATH}" | sudo tee -a /etc/shells >/dev/null
    fi
    if [ "$SHELL" != "${FISH_PATH}" ]; then
        log_info "Setting fish as default shell"
        chsh -s "${FISH_PATH}" || log_warn "Failed to set fish as default shell"
    fi
fi

log_success "macOS dotfiles install completed"
