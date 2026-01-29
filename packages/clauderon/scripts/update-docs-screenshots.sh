#!/usr/bin/env bash
# Copy generated screenshots to docs assets directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$PROJECT_DIR/docs"

SCREENSHOTS_SRC="$PROJECT_DIR/screenshots"
SCREENSHOTS_DEST="$DOCS_DIR/src/assets/screenshots"

echo "Copying screenshots to documentation assets..."
echo "Source: $SCREENSHOTS_SRC"
echo "Destination: $SCREENSHOTS_DEST"
echo ""

# Create destination directories
mkdir -p "$SCREENSHOTS_DEST/cli"
mkdir -p "$SCREENSHOTS_DEST/tui"
mkdir -p "$SCREENSHOTS_DEST/web"

# Copy CLI screenshots (SVG)
if [ -d "$SCREENSHOTS_SRC/cli" ]; then
    echo "Copying CLI screenshots..."
    cp -v "$SCREENSHOTS_SRC/cli"/*.svg "$SCREENSHOTS_DEST/cli/" 2>/dev/null || echo "  No CLI screenshots found"
fi

# Copy TUI screenshots (PNG)
if [ -d "$SCREENSHOTS_SRC/tui" ]; then
    echo "Copying TUI screenshots..."
    cp -v "$SCREENSHOTS_SRC/tui"/*.png "$SCREENSHOTS_DEST/tui/" 2>/dev/null || echo "  No TUI screenshots found"
fi

# Copy Web screenshots (PNG)
if [ -d "$SCREENSHOTS_SRC/web" ]; then
    echo "Copying Web UI screenshots..."
    cp -v "$SCREENSHOTS_SRC/web"/*.png "$SCREENSHOTS_DEST/web/" 2>/dev/null || echo "  No Web screenshots found"
fi

echo ""
echo "✓ Screenshots copied to $SCREENSHOTS_DEST"
echo ""
ls -lh "$SCREENSHOTS_DEST"/*/ 2>/dev/null || echo "No screenshots in destination"
