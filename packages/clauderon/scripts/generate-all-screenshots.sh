#!/usr/bin/env bash
# Master script to generate all screenshots for documentation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=========================================="
echo "Clauderon Screenshot Generation"
echo "=========================================="
echo ""

# Step 1: Generate CLI screenshots
echo "📸 Step 1/3: Generating CLI screenshots (SVG)..."
echo "------------------------------------------"
if [ -x "$SCRIPT_DIR/generate-cli-screenshots.sh" ]; then
    "$SCRIPT_DIR/generate-cli-screenshots.sh"
else
    echo "Warning: generate-cli-screenshots.sh not executable"
    bash "$SCRIPT_DIR/generate-cli-screenshots.sh"
fi
echo ""

# Step 2: Generate TUI screenshots
echo "📸 Step 2/3: Generating TUI screenshots (PNG)..."
echo "------------------------------------------"
cd "$PROJECT_DIR"
if cargo test --test screenshot_tests -- --ignored --nocapture 2>&1; then
    echo "✓ TUI screenshots generated"
else
    echo "Warning: TUI screenshot generation failed (build issue)"
    echo "  This is expected if Rust build is not working"
fi
echo ""

# Step 3: Generate Web UI screenshots
echo "📸 Step 3/3: Generating Web UI screenshots (PNG)..."
echo "------------------------------------------"
cd "$PROJECT_DIR/web/frontend"
if command -v bun &> /dev/null; then
    # Install dependencies if needed
    if [ ! -d "node_modules/@playwright/test" ]; then
        echo "Installing Playwright..."
        bun add -d @playwright/test
        bun playwright install chromium
    fi

    # Run screenshot tests
    if bun run screenshots 2>&1; then
        echo "✓ Web UI screenshots generated"
    else
        echo "Warning: Web UI screenshot generation failed"
        echo "  Make sure the dev server is running or check playwright config"
    fi
else
    echo "Warning: bun not found, skipping Web UI screenshots"
    echo "  Install bun and run: cd web/frontend && bun run screenshots"
fi
echo ""

# Step 4: Copy to docs
echo "📚 Step 4/4: Copying screenshots to docs..."
echo "------------------------------------------"
cd "$PROJECT_DIR"
if [ -x "$SCRIPT_DIR/update-docs-screenshots.sh" ]; then
    "$SCRIPT_DIR/update-docs-screenshots.sh"
else
    bash "$SCRIPT_DIR/update-docs-screenshots.sh"
fi
echo ""

echo "=========================================="
echo "✓ Screenshot generation complete!"
echo "=========================================="
echo ""
echo "Screenshots location:"
echo "  Source:  $PROJECT_DIR/screenshots/"
echo "  Docs:    $PROJECT_DIR/../../docs/src/assets/screenshots/"
echo ""
echo "Next steps:"
echo "  1. Review generated screenshots"
echo "  2. Commit to git: git add screenshots/ docs/"
echo "  3. Build docs: cd docs && bun run build"
echo ""
