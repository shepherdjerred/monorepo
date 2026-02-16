#!/bin/bash
# Docker Image Validation Script
# Tests functionality and captures state for comparison

set -euo pipefail

IMAGE="${1:-ghcr.io/shepherdjerred/dotfiles:latest}"
OUTPUT_FILE="${2:-/tmp/docker-image-test-results.txt}"

echo "Testing Docker image: $IMAGE"
echo "Output file: $OUTPUT_FILE"
echo ""

# Use platform flag for cross-platform compatibility
DOCKER_RUN="docker run --rm --platform linux/amd64 $IMAGE"

{
    echo "=============================================="
    echo "Docker Image Test Results"
    echo "Image: $IMAGE"
    echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "=============================================="
    echo ""

    # --- Image Size ---
    echo "=== IMAGE SIZE ==="
    docker images "$IMAGE" --format "Size: {{.Size}}"
    echo ""

    # --- Layer Analysis ---
    echo "=== TOP 10 LAYERS BY SIZE ==="
    docker history "$IMAGE" --format "{{.Size}}\t{{.CreatedBy}}" | head -10
    echo ""

    # --- User & Permissions ---
    echo "=== USER & PERMISSIONS ==="
    $DOCKER_RUN bash -c 'echo "User: $(whoami)"; echo "ID: $(id)"; echo "Home: $HOME"'
    echo ""

    # --- Environment ---
    echo "=== ENVIRONMENT ==="
    $DOCKER_RUN bash -c 'echo "PATH: $PATH"; echo "SHELL: $SHELL"'
    echo ""

    # --- Shell ---
    echo "=== SHELL ==="
    $DOCKER_RUN bash -c 'fish --version 2>/dev/null || echo "fish: NOT FOUND"'
    $DOCKER_RUN bash -c 'cat /etc/shells | grep fish || echo "fish not in /etc/shells"'
    echo ""

    # --- Homebrew ---
    echo "=== HOMEBREW ==="
    $DOCKER_RUN bash -c 'brew --version 2>/dev/null || echo "brew: NOT FOUND"'
    $DOCKER_RUN bash -c 'brew list --formula 2>/dev/null | wc -l | xargs echo "Installed formulas:"'
    $DOCKER_RUN bash -c 'brew list --cask 2>/dev/null | wc -l | xargs echo "Installed casks:"'
    echo ""

    # --- Homebrew Packages ---
    echo "=== HOMEBREW PACKAGES (spot check) ==="
    for pkg in git kubectl helm gh jq ripgrep bat eza starship mise neovim fish; do
        $DOCKER_RUN bash -c "command -v $pkg >/dev/null 2>&1 && echo '$pkg: OK' || echo '$pkg: MISSING'"
    done
    echo ""

    # --- Mise ---
    echo "=== MISE ==="
    $DOCKER_RUN bash -c 'mise --version 2>/dev/null || echo "mise: NOT FOUND"'
    $DOCKER_RUN bash -c 'ls -1 ~/.local/share/mise/installs/ 2>/dev/null || echo "No mise installs found"'
    echo ""

    # --- Mise Runtimes ---
    echo "=== MISE RUNTIMES ==="
    $DOCKER_RUN bash -c 'source /etc/profile.d/linuxbrew.sh 2>/dev/null; node --version 2>/dev/null || echo "node: NOT FOUND"'
    $DOCKER_RUN bash -c 'source /etc/profile.d/linuxbrew.sh 2>/dev/null; python --version 2>/dev/null || echo "python: NOT FOUND"'
    $DOCKER_RUN bash -c 'source /etc/profile.d/linuxbrew.sh 2>/dev/null; go version 2>/dev/null || echo "go: NOT FOUND"'
    $DOCKER_RUN bash -c 'source /etc/profile.d/linuxbrew.sh 2>/dev/null; java --version 2>/dev/null | head -1 || echo "java: NOT FOUND"'
    $DOCKER_RUN bash -c 'source /etc/profile.d/linuxbrew.sh 2>/dev/null; bun --version 2>/dev/null || echo "bun: NOT FOUND"'
    echo ""

    # --- Neovim/LunarVim ---
    echo "=== NEOVIM/LUNARVIM ==="
    $DOCKER_RUN bash -c 'nvim --version 2>/dev/null | head -1 || echo "nvim: NOT FOUND"'
    $DOCKER_RUN bash -c 'command -v lvim >/dev/null 2>&1 && echo "lvim: OK" || echo "lvim: NOT FOUND"'
    $DOCKER_RUN bash -c 'ls -d ~/.local/share/lunarvim 2>/dev/null && echo "lunarvim dir: OK" || echo "lunarvim dir: MISSING"'
    echo ""

    # --- Tmux ---
    echo "=== TMUX ==="
    $DOCKER_RUN bash -c 'tmux -V 2>/dev/null || echo "tmux: NOT FOUND"'
    $DOCKER_RUN bash -c 'ls ~/.tmux/plugins/ 2>/dev/null | wc -l | xargs echo "tmux plugins:"'
    $DOCKER_RUN bash -c 'test -f ~/.tmux.conf && echo "tmux.conf: OK" || echo "tmux.conf: MISSING"'
    echo ""

    # --- Config Files ---
    echo "=== CONFIG FILES ==="
    $DOCKER_RUN bash -c 'test -d ~/.config && echo "~/.config: OK" || echo "~/.config: MISSING"'
    $DOCKER_RUN bash -c 'test -d ~/.local && echo "~/.local: OK" || echo "~/.local: MISSING"'
    $DOCKER_RUN bash -c 'ls ~/.config/ 2>/dev/null | head -10 | xargs echo "~/.config contents:"'
    echo ""

    # --- Directory Sizes ---
    echo "=== DIRECTORY SIZES ==="
    $DOCKER_RUN bash -c 'du -sh /home/linuxbrew/.linuxbrew 2>/dev/null || echo "linuxbrew: N/A"'
    $DOCKER_RUN bash -c 'du -sh ~/.local 2>/dev/null || echo "~/.local: N/A"'
    $DOCKER_RUN bash -c 'du -sh ~/.local/share/mise 2>/dev/null || echo "mise: N/A"'
    $DOCKER_RUN bash -c 'du -sh ~/.config 2>/dev/null || echo "~/.config: N/A"'
    echo ""

    # --- Orphaned Files Check ---
    echo "=== ORPHANED FILES CHECK (should be empty/minimal) ==="
    $DOCKER_RUN bash -c 'sudo du -sh /root/.local 2>/dev/null || echo "/root/.local: N/A"'
    $DOCKER_RUN bash -c 'sudo du -sh /root/.nuget 2>/dev/null || echo "/root/.nuget: N/A"'
    $DOCKER_RUN bash -c 'sudo du -sh /root/.rustup 2>/dev/null || echo "/root/.rustup: N/A"'
    $DOCKER_RUN bash -c 'sudo du -sh /root/.cache 2>/dev/null || echo "/root/.cache: N/A"'
    echo ""

    # --- Entrypoint ---
    echo "=== ENTRYPOINT ==="
    $DOCKER_RUN bash -c 'test -x /usr/local/bin/docker-entrypoint.sh && echo "entrypoint: OK" || echo "entrypoint: MISSING"'
    echo ""

    echo "=============================================="
    echo "Test completed at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "=============================================="

} 2>&1 | tee "$OUTPUT_FILE"

echo ""
echo "Results saved to: $OUTPUT_FILE"
