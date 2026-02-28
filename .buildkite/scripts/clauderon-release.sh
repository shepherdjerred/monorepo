#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/setup-tools.sh"

install_base
install_uv
install_gh

# Install Rust toolchain
echo "--- :rust: Installing Rust toolchain"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Add cross-compilation targets
rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu

# Install cross-compilation linker
apt-get install -y -qq gcc-aarch64-linux-gnu > /dev/null

# Configure cargo for cross-compilation
mkdir -p .cargo
cat > .cargo/config.toml << 'EOF'
[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"
EOF

echo "+++ :rust: Clauderon Release"
cd scripts/ci && uv run python -m ci.clauderon_release
