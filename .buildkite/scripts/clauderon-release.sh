#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv
install_gh
install_rust

# Configure cargo for cross-compilation
mkdir -p .cargo
cat > .cargo/config.toml << 'EOF'
[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"
EOF

echo "+++ :rust: Clauderon Release"
cd scripts/ci && PYTHONPATH=src uv run python -m ci.clauderon_release
