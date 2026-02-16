#!/usr/bin/env bash
# Helper script to run the Apple HIG scraper with all dependencies

set -e

echo "Apple HIG Scraper Runner"
echo "========================"
echo ""

# Check if running in Docker
if [ -f /.dockerenv ]; then
    echo "✓ Running in Docker container"
    export PATH="/workspace/.local/bin:$PATH"
    uv run /workspace/scripts/scrape-apple-hig.py "$@"
    exit 0
fi

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# Check if Playwright dependencies are installed
if ! ldconfig -p 2>/dev/null | grep -q libnss3; then
    echo "⚠ Playwright system dependencies not found"
    echo ""
    echo "Please install dependencies first:"
    echo ""
    echo "Option 1 - Using Playwright's installer (recommended):"
    echo "  sudo $(which python3 || echo python) -m playwright install-deps chromium"
    echo ""
    echo "Option 2 - Using apt directly:"
    echo "  sudo apt-get update && sudo apt-get install -y \\"
    echo "    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \\"
    echo "    libatk-bridge2.0-0 libcups2 libdrm2 libxcb1 libxkbcommon0 \\"
    echo "    libatspi2.0-0 libx11-6 libxcomposite1 libxdamage1 libxext6 \\"
    echo "    libxfixes3 libxrandr2 libgbm1 libcairo2 libpango-1.0-0 libasound2"
    echo ""
    echo "Option 3 - Using Docker:"
    echo "  docker run --rm -v \$(pwd):/workspace -w /workspace \\"
    echo "    mcr.microsoft.com/playwright/python:v1.49.0-noble \\"
    echo "    /workspace/run-hig-scraper.sh"
    echo ""
    exit 1
fi

# Run the scraper
export PATH="/workspace/.local/bin:$PATH"
uv run /workspace/scripts/scrape-apple-hig.py "$@"
