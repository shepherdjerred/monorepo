#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
SKILL_DIR="${HOME}/.claude/skills"
RECALL_DIR="${HOME}/.recall"

echo "Building toolkit..."
cd "$SCRIPT_DIR"
bun build ./src/index.ts --compile --external ffmpeg-static --outfile=dist/toolkit

echo "Installing binary to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
# Unlink the destination before copying. If the previous binary is still running
# (e.g. the recall daemon holds it mmap'd), overwriting the same inode corrupts
# the code signature of the new copy and macOS kills it with "Killed: 9". rm
# leaves the running process on its now-unlinked inode and gives us a fresh one.
rm -f "$INSTALL_DIR/toolkit"
cp dist/toolkit "$INSTALL_DIR/toolkit"
chmod +x "$INSTALL_DIR/toolkit"
# Re-apply an ad-hoc signature on macOS so a broken/missing signature never makes
# the binary unrunnable (Bun --compile self-signs, but copies can lose it).
if [[ "$(uname)" == "Darwin" ]]; then
  codesign --force --sign - "$INSTALL_DIR/toolkit"
fi

echo "Installing skills to ${SKILL_DIR}..."
mkdir -p "$SKILL_DIR/pr-health"
cp skills/pr-health/SKILL.md "$SKILL_DIR/pr-health/SKILL.md"

if [ -d skills/recall ]; then
  mkdir -p "$SKILL_DIR/recall"
  cp skills/recall/SKILL.md "$SKILL_DIR/recall/SKILL.md"
fi

echo "Creating recall directories..."
mkdir -p "$RECALL_DIR/fetched"
mkdir -p "$RECALL_DIR/logs"

# Install MLX embedding dependencies (non-fatal — keyword search still works without it)
echo "Installing MLX embeddings..."
if python3 -c "import mlx_embedding_models" 2>/dev/null; then
  echo "  mlx-embedding-models already installed"
else
  python3 -m pip install --user mlx-embedding-models "transformers<5" einops || echo "  Warning: MLX install failed. Keyword search will still work."
fi

# Install and start daemon
PLIST_SRC="$SCRIPT_DIR/../dotfiles/Library/LaunchAgents/com.shepherdjerred.toolkit-recall.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.shepherdjerred.toolkit-recall.plist"
if [ -f "$PLIST_SRC" ]; then
  echo "Installing daemon plist..."
  mkdir -p "$HOME/Library/LaunchAgents"
  # Stop existing daemon if running
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  cp "$PLIST_SRC" "$PLIST_DST"
  launchctl load "$PLIST_DST"
  echo "  Daemon started"
fi

# Remove old 'tools' binary if it exists
if [ -f "$INSTALL_DIR/tools" ]; then
  echo "Removing old 'tools' binary..."
  rm "$INSTALL_DIR/tools"
fi

echo ""
echo "Installation complete!"
echo ""
echo "Make sure ${INSTALL_DIR} is in your PATH:"
echo "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
echo ""
echo "You can now use:"
echo "  toolkit pr health"
echo "  toolkit fetch <url>"
echo "  toolkit recall search <query>"
echo "  toolkit recall status"
