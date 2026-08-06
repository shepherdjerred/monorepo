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

# Berkeley Mono is licensed, so its source fonts are intentionally not stored in
# Git. Before a macOS reinstall, download and extract the static desktop TTF
# package under ~/Downloads. If it lives elsewhere, set
# BERKELEY_MONO_SOURCE_DIR to that extracted directory when running this script.
# The patcher downloaded later is only the public Nerd Fonts glyph patcher.
discover_berkeley_mono_source_dir() {
    if [ -n "${BERKELEY_MONO_SOURCE_DIR:-}" ]; then
        if [ ! -d "${BERKELEY_MONO_SOURCE_DIR}" ]; then
            log_error "BERKELEY_MONO_SOURCE_DIR is not a directory: ${BERKELEY_MONO_SOURCE_DIR}"
            return 1
        fi
        printf "%s\n" "${BERKELEY_MONO_SOURCE_DIR}"
        return 0
    fi

    local regular_fonts=()
    local font_path
    while IFS= read -r font_path; do
        regular_fonts+=("${font_path}")
    done < <(fd --absolute-path --type f '^BerkeleyMono-Regular\.ttf$' "${HOME}/Downloads")

    if [ "${#regular_fonts[@]}" -ne 1 ]; then
        log_error "Expected exactly one BerkeleyMono-Regular.ttf under ${HOME}/Downloads; found ${#regular_fonts[@]}"
        log_error "Set BERKELEY_MONO_SOURCE_DIR to the extracted static TTF directory"
        return 1
    fi

    dirname "${regular_fonts[0]}"
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
    DOTFILES_SOURCE_DIR="$(cd "${DOTFILES_LOCAL_PATH}" && pwd)"
    log_info "Using local dotfiles from: ${DOTFILES_SOURCE_DIR}"
    if ! chezmoi init --source "${DOTFILES_SOURCE_DIR}" --apply --keep-going; then
        log_warn "chezmoi apply encountered errors; continuing because secrets may be unavailable"
    fi
else
    log_info "Cloning dotfiles from GitHub"
    mkdir -p "${HOME}/git"
    if [ -d "${HOME}/git/monorepo/.git" ]; then
        retry 3 5 git -C "${HOME}/git/monorepo" pull --ff-only
    else
        retry 3 5 git clone --depth 1 https://github.com/shepherdjerred/monorepo.git "${HOME}/git/monorepo"
    fi
    DOTFILES_SOURCE_DIR="${HOME}/git/monorepo/packages/dotfiles"
    if ! chezmoi init --source "${DOTFILES_SOURCE_DIR}" --apply --keep-going; then
        log_warn "chezmoi apply encountered errors; continuing because secrets may be unavailable"
    fi
fi

# Install Brewfile
if command -v brew &>/dev/null; then
    log_info "Trusting third-party Homebrew formulae"
    third_party_formulae=(
        "artginzburg/tap/sudo-touchid"
        "cormacrelf/tap/dark-notify"
        "dsully/tap/macos-defaults"
        "rsteube/tap/carapace"
        "siderolabs/tap/talosctl"
    )
    for formula in "${third_party_formulae[@]}"; do
        tap="${formula%/*}"
        retry 3 5 brew tap "$tap"
        brew trust --formula "$formula"
    done

    log_info "Installing Brewfile packages"
    (cd ~ && retry 3 5 brew bundle --file=.Brewfile)
    log_success "Brewfile packages installed"

    log_info "Enabling Touch ID for sudo, including terminal multiplexer support"
    sudo-touchid --with-reattach
    log_success "Touch ID for sudo enabled"

    log_info "Patching and installing Berkeley Mono"
    berkeley_mono_source_dir="$(discover_berkeley_mono_source_dir)"
    berkeley_mono_patcher="$(dirname "${DOTFILES_SOURCE_DIR}")/fonts/patch-berkeley-mono.py"
    if [ ! -f "${berkeley_mono_patcher}" ]; then
        log_error "Berkeley Mono patcher is missing: ${berkeley_mono_patcher}"
        exit 1
    fi
    uv run "${berkeley_mono_patcher}" \
        "${berkeley_mono_source_dir}" \
        "${HOME}/.cache/berkeley-mono/patched" \
        --install
    log_success "Berkeley Mono patched and installed"

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

    log_info "Registering the active mise JDK with macOS"
    java_path="$(mise where java)"
    java_contents="${java_path}/Contents"
    system_java_contents="/Library/Java/JavaVirtualMachines/mise-java.jdk/Contents"
    if [ ! -d "$java_contents" ]; then
        log_error "Active mise Java installation is not a macOS JDK: ${java_path}"
        exit 1
    fi
    if [ -e "$system_java_contents" ] && [ ! -L "$system_java_contents" ]; then
        log_error "Refusing to replace non-symlink JDK registration: ${system_java_contents}"
        exit 1
    fi
    sudo mkdir -p "$(dirname "$system_java_contents")"
    sudo ln -sfn "$java_contents" "$system_java_contents"
    log_success "Active mise JDK registered with macOS"
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
    nvim --headless "+lua require('config.treesitter').install():wait(300000)" +qa
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

# Initialize desktop services that should survive login/reboot. Syncthing
# device and folder enrollment remains an explicit operator step.
if [ -d "/Applications/Syncthing.app" ]; then
    log_info "Starting Syncthing and enabling launch at login"
    defaults write com.github.xor-gate.syncthing-macosx StartAtLogin -bool true
    if [ "$(osascript -e 'tell application "System Events" to exists login item "Syncthing"')" != "true" ]; then
        osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Syncthing.app", hidden:true}'
    fi
    open -a Syncthing
fi

if command -v orbctl &>/dev/null; then
    log_info "Starting OrbStack and enabling launch at login"
    orbctl config set app.start_at_login true
    orbctl start
    if ! command -v docker &>/dev/null; then
        log_warn "OrbStack is running but Docker CLI setup is incomplete; finish setup in the OrbStack app"
        open -a OrbStack
    fi
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

log_success "Automated macOS dotfiles install completed"
log_warn "Manual setup remains; review packages/dotfiles/MACOS_FRESH_INSTALL.md"
