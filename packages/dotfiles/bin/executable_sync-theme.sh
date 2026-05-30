#!/bin/bash
set -euo pipefail

# Detect macOS appearance via AppleScript (avoids `defaults read` writing to
# stderr when AppleInterfaceStyle is unset in Light mode).
DARK=$(osascript -e 'tell application "System Events" to tell appearance preferences to return dark mode')
if [[ "$DARK" == "true" ]]; then
    M=mocha
    THEME_MODE=dark
else
    M=latte
    THEME_MODE=light
fi

# btop (sed only the color_theme = "..." line)
if [[ -f ~/.config/btop/btop.conf ]]; then
    sed -E -i '' "s/^color_theme = \"catppuccin_(latte|frappe|macchiato|mocha)\"/color_theme = \"catppuccin_$M\"/" ~/.config/btop/btop.conf
    if pgrep -q btop; then pkill -USR2 btop; fi
fi

# starship (sed only the top-level palette = line)
if [[ -f ~/.config/starship.toml ]]; then
    sed -E -i '' "s/^palette = \"catppuccin_(latte|frappe|macchiato|mocha)\"/palette = \"catppuccin_$M\"/" ~/.config/starship.toml
fi

# Atuin (sed only the [theme] name = "..." line)
if [[ -f ~/.config/atuin/config.toml ]]; then
    sed -E -i '' "s/^name = \"catppuccin-(latte|frappe|macchiato|mocha)\"/name = \"catppuccin-$M\"/" ~/.config/atuin/config.toml
fi

# eza (macOS - symlink theme file)
EZA_DIR=~/Library/"Application Support"/eza
if [[ -d "$EZA_DIR" && -f "$EZA_DIR/theme-$M.yml" ]]; then
    ln -sf "theme-$M.yml" "$EZA_DIR/theme.yml"
fi

# ov (symlink config file)
OV_DIR=~/.config/ov
if [[ -d "$OV_DIR" && -f "$OV_DIR/config-$M.yaml" ]]; then
    ln -sf "config-$M.yaml" "$OV_DIR/config.yaml"
fi

# fish env vars (FZF, DFT_BACKGROUND, JQ_COLORS, LS_COLORS) — rewrite theme-env.fish
THEME_ENV=~/.config/fish/conf.d/theme-env.fish
if [[ -d "$(dirname "$THEME_ENV")" ]]; then
    case "$M" in
        latte)
            cat > "$THEME_ENV" <<'EOF'
set -gx FZF_DEFAULT_OPTS "--color=bg+:ccd0da,bg:eff1f5,spinner:dc8a78,hl:d20f39,fg:4c4f69,header:d20f39,info:8839ef,pointer:dc8a78,marker:7287fd,fg+:4c4f69,prompt:8839ef,hl+:d20f39,selected-bg:bcc0cc"
set -gx DFT_BACKGROUND light
set -gx JQ_COLORS "0;90:0;31:0;32:0;33:0;32:0;34:0;34:1;35"
set -gx LS_COLORS (vivid generate catppuccin-latte)
EOF
            ;;
        mocha)
            cat > "$THEME_ENV" <<'EOF'
set -gx FZF_DEFAULT_OPTS "--color=bg+:313244,bg:1e1e2e,spinner:f5e0dc,hl:f38ba8,fg:cdd6f4,header:f38ba8,info:cba6f7,pointer:f5e0dc,marker:b4befe,fg+:cdd6f4,prompt:cba6f7,hl+:f38ba8,selected-bg:45475a"
set -gx DFT_BACKGROUND dark
set -gx JQ_COLORS "2;37:0;31:0;32:0;33:0;32:0;34:0;34:1;35"
set -gx LS_COLORS (vivid generate catppuccin-mocha)
EOF
            ;;
    esac
fi

# Git delta + difft — written to ~/.gitconfig-theme, included from chezmoi-managed .gitconfig
cat > ~/.gitconfig-theme <<EOF
[diff]
  external = difft --background=$THEME_MODE
[difftool "difftastic"]
  cmd = difft --background=$THEME_MODE "\$LOCAL" "\$REMOTE"
[delta]
  features = catppuccin-$M
EOF

# Claude Code uses theme = "auto" natively — no sync needed.
