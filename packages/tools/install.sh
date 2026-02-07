#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
SKILL_DIR="${HOME}/.claude/skills/pr-health"

echo "Building tools..."
cd "$SCRIPT_DIR"
bun build ./src/index.ts --compile --outfile=dist/tools

echo "Installing binary to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
cp dist/tools "$INSTALL_DIR/tools"
chmod +x "$INSTALL_DIR/tools"

echo "Installing skill to ${SKILL_DIR}..."
mkdir -p "$SKILL_DIR"
cp skills/pr-health/SKILL.md "$SKILL_DIR/SKILL.md"

echo ""
echo "Installation complete!"
echo ""
echo "Make sure ${INSTALL_DIR} is in your PATH:"
echo "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
echo ""
echo "You can now use:"
echo "  tools pr health"
echo "  tools pr logs <run-id>"
echo "  tools pr detect"
