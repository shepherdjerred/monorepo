#!/usr/bin/env bash
# Common tool installation for CI scripts.
# Source this file: source "$(dirname "$0")/setup-tools.sh"
set -euo pipefail

BAZELISK_VERSION="1.25.0"

fix_git_alternates() {
    if [ -f .git/objects/info/alternates ]; then
        echo "--- Fixing git alternates"
        git repack -a -d 2>/dev/null || true
        rm -f .git/objects/info/alternates
    fi
}

install_base() {
    if command -v jq &>/dev/null && command -v gcc &>/dev/null; then
        echo "--- :debian: System dependencies already installed, skipping"
        return
    fi
    echo "--- :debian: Installing system dependencies"
    apt-get update -qq && apt-get install -y -qq curl jq git ca-certificates unzip gcc g++ python3 libssl-dev pkg-config > /dev/null
}

install_ripgrep() {
    if command -v rg &>/dev/null; then
        echo "--- :mag: ripgrep already installed, skipping"
        return
    fi
    echo "--- :mag: Installing ripgrep"
    curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz" | tar xz -C /tmp
    cp /tmp/ripgrep-14.1.1-x86_64-unknown-linux-musl/rg /usr/local/bin/rg
    chmod +x /usr/local/bin/rg
}

install_bazel() {
    if command -v bazel &>/dev/null; then
        echo "--- :bazel: Bazelisk already installed, skipping"
        return
    fi
    echo "--- :bazel: Installing Bazelisk ${BAZELISK_VERSION}"
    curl -fsSL "https://github.com/bazelbuild/bazelisk/releases/download/v${BAZELISK_VERSION}/bazelisk-linux-amd64" -o /usr/local/bin/bazel
    chmod +x /usr/local/bin/bazel
}

install_uv() {
    if command -v uv &>/dev/null; then
        echo "--- :python: uv already installed, skipping"
        return
    fi
    echo "--- :python: Installing uv"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
}

install_kubectl() {
    if command -v kubectl &>/dev/null; then
        echo "--- :kubectl: kubectl already installed, skipping"
        return
    fi
    local kubectl_version="v1.34.1"
    echo "--- :kubectl: Installing kubectl ${kubectl_version}"
    curl -fsSL "https://dl.k8s.io/release/${kubectl_version}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl
    chmod +x /usr/local/bin/kubectl
}

install_helm() {
    if command -v helm &>/dev/null; then
        echo "--- :helm: Helm already installed, skipping"
        return
    fi
    echo "--- :helm: Installing Helm"
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
}

install_awscli() {
    if command -v aws &>/dev/null; then
        echo "--- :aws: AWS CLI already installed, skipping"
        return
    fi
    echo "--- :aws: Installing AWS CLI"
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -q awscliv2.zip
    ./aws/install
    rm -rf awscliv2.zip aws
}

install_tofu() {
    if command -v tofu &>/dev/null; then
        echo "--- :terraform: OpenTofu already installed, skipping"
        return
    fi
    echo "--- :terraform: Installing OpenTofu"
    curl -fsSL https://get.opentofu.org/install-opentofu.sh | bash -s -- --install-method standalone
}

install_node() {
    if command -v node &>/dev/null; then
        echo "--- :nodejs: Node.js already installed, skipping"
        return
    fi
    echo "--- :nodejs: Installing Node.js"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs > /dev/null
}

install_bun() {
    if command -v bun &>/dev/null; then
        echo "--- :bun: Bun already installed, skipping"
        return
    fi
    echo "--- :bun: Installing Bun"
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
}

install_gh() {
    if command -v gh &>/dev/null; then
        echo "--- :github: GitHub CLI already installed, skipping"
        return
    fi
    echo "--- :github: Installing GitHub CLI"
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    apt-get update -qq && apt-get install -y -qq gh > /dev/null
}

install_target_determinator() {
    if command -v target-determinator &>/dev/null; then
        echo "--- :bazel: target-determinator already installed, skipping"
        return
    fi
    local version="0.32.0"
    echo "--- :bazel: Installing target-determinator ${version}"
    curl -fsSL "https://github.com/bazel-contrib/target-determinator/releases/download/v${version}/target-determinator.linux.amd64" -o /usr/local/bin/target-determinator
    chmod +x /usr/local/bin/target-determinator
}

install_rust() {
    if command -v rustc &>/dev/null; then
        echo "--- :rust: Rust already installed, skipping"
        return
    fi
    echo "--- :rust: Installing Rust toolchain"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu
    apt-get install -y -qq gcc-aarch64-linux-gnu > /dev/null
}

# Auto-fix git alternates when sourced (every CI step gets a fresh clone)
fix_git_alternates
