#!/bin/bash
set -euo pipefail

# Detect mode
MODE=$(defaults read -g AppleInterfaceStyle 2>/dev/null || echo "Light")
[[ "$MODE" == "Dark" ]] && M=mocha || M=latte
THEME_MODE=$([[ "$MODE" == "Dark" ]] && echo dark || echo light)

# Zellij — only the `theme "..."` selector line; never the four block declarations
sed -E -i '' "s/^theme \"catppuccin-(latte|frappe|macchiato|mocha)\"/theme \"catppuccin-$M\"/" ~/.config/zellij/config.kdl

# btop (only the color_theme = "..." line)
sed -E -i '' "s/^color_theme = \"catppuccin_(latte|frappe|macchiato|mocha)\"/color_theme = \"catppuccin_$M\"/" ~/.config/btop/btop.conf
if pgrep -q btop; then pkill -USR2 btop; fi

# starship (only change the palette = line, not the section headers)
sed -E -i '' "s/^palette = \"catppuccin_(latte|frappe|macchiato|mocha)\"/palette = \"catppuccin_$M\"/" ~/.config/starship.toml

# Atuin (only the [theme] name = "..." line)
sed -E -i '' "s/^name = \"catppuccin-(latte|frappe|macchiato|mocha)\"/name = \"catppuccin-$M\"/" ~/.config/atuin/config.toml

# eza (macOS - symlink theme file)
EZA_DIR=~/Library/"Application Support"/eza
[[ -d "$EZA_DIR" ]] && ln -sf "$EZA_DIR/theme-$M.yml" "$EZA_DIR/theme.yml"

# ov (symlink config file)
OV_DIR=~/.config/ov
[[ -d "$OV_DIR" ]] && ln -sf "$OV_DIR/config-$M.yaml" "$OV_DIR/config.yaml"

# fzf + difftastic + jq + LS_COLORS (fish env vars)
THEME_DIR=~/.config/fish/conf.d
[[ -f "$THEME_DIR/theme-env-$M.fish" ]] && ln -sf "theme-env-$M.fish" "$THEME_DIR/theme-env.fish"

# Git config (difft + delta) — write to include file to avoid clobbering chezmoi-managed .gitconfig
cat > ~/.gitconfig-theme << EOF
[diff]
  external = difft --background=$THEME_MODE
[difftool "difftastic"]
  cmd = difft --background=$THEME_MODE "\$LOCAL" "\$REMOTE"
[delta]
  features = catppuccin-$M
EOF

# Claude Code (settings.json)
CLAUDE_SETTINGS=~/.claude/settings.json
if [[ -f "$CLAUDE_SETTINGS" ]] && command -v jq &>/dev/null; then
  TMP=$(mktemp)
  jq --arg t "$THEME_MODE" '.theme = $t' "$CLAUDE_SETTINGS" > "$TMP" && mv "$TMP" "$CLAUDE_SETTINGS"
fi

# Claude Code (.claude.json)
CLAUDE_JSON=~/.claude.json
if [[ -f "$CLAUDE_JSON" ]] && command -v jq &>/dev/null; then
  TMP=$(mktemp)
  jq --arg t "$THEME_MODE" '.theme = $t' "$CLAUDE_JSON" > "$TMP" && mv "$TMP" "$CLAUDE_JSON"
fi

# Gemini CLI
GEMINI=~/.gemini/settings.json
if [[ -f "$GEMINI" ]] && command -v jq &>/dev/null; then
  THEME=$([[ "$M" == "mocha" ]] && echo "GitHub" || echo "GitHub Light")
  TMP=$(mktemp)
  jq --arg t "$THEME" '.ui.theme = $t' "$GEMINI" > "$TMP" && mv "$TMP" "$GEMINI"
fi
