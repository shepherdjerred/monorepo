#!/usr/bin/env bash
# Common tool installation for CI scripts.
# Source this file: source "$(dirname "$0")/setup-tools.sh"
set -euo pipefail

# renovate: datasource=github-releases depName=bazelbuild/bazelisk
BAZELISK_VERSION="1.28.1"

# renovate: datasource=github-releases depName=BurntSushi/ripgrep
RIPGREP_VERSION="14.1.1"

# renovate: datasource=github-releases depName=kubernetes/kubectl
KUBECTL_VERSION="v1.34.1"

# renovate: datasource=github-releases depName=koalaman/shellcheck
SHELLCHECK_VERSION="0.10.0"

# renovate: datasource=github-releases depName=bazel-contrib/target-determinator
TARGET_DETERMINATOR_VERSION="0.32.0"

# renovate: datasource=github-releases depName=astral-sh/uv
UV_VERSION="0.6.9"

# renovate: datasource=github-releases depName=helm/helm
HELM_VERSION="v3.17.3"

# renovate: datasource=github-tags depName=aws/aws-cli versioning=semver
AWSCLI_VERSION="2.27.22"

# renovate: datasource=github-releases depName=opentofu/opentofu
OPENTOFU_VERSION="1.9.1"

# renovate: datasource=github-releases depName=oven-sh/bun
BUN_VERSION="1.3.9"

# renovate: datasource=github-releases depName=cli/cli
GH_VERSION="2.72.0"

# renovate: datasource=github-releases depName=rust-lang/rustup versioning=semver
RUSTUP_VERSION="1.28.2"

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
    echo "--- :mag: Installing ripgrep ${RIPGREP_VERSION}"
    curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz" | tar xz -C /tmp
    cp /tmp/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl/rg /usr/local/bin/rg
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
    echo "--- :python: Installing uv ${UV_VERSION}"
    curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh
    export PATH="$HOME/.local/bin:$PATH"
}

install_kubectl() {
    if command -v kubectl &>/dev/null; then
        echo "--- :kubectl: kubectl already installed, skipping"
        return
    fi
    echo "--- :kubectl: Installing kubectl ${KUBECTL_VERSION}"
    curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl
    chmod +x /usr/local/bin/kubectl
}

install_helm() {
    if command -v helm &>/dev/null; then
        echo "--- :helm: Helm already installed, skipping"
        return
    fi
    echo "--- :helm: Installing Helm ${HELM_VERSION}"
    curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" | tar xz -C /tmp
    mv /tmp/linux-amd64/helm /usr/local/bin/helm
    chmod +x /usr/local/bin/helm
    rm -rf /tmp/linux-amd64
}

install_awscli() {
    if command -v aws &>/dev/null; then
        echo "--- :aws: AWS CLI already installed, skipping"
        return
    fi
    echo "--- :aws: Installing AWS CLI ${AWSCLI_VERSION}"
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWSCLI_VERSION}.zip" -o "awscliv2.zip"
    unzip -q awscliv2.zip
    ./aws/install
    rm -rf awscliv2.zip aws
}

install_tofu() {
    if command -v tofu &>/dev/null; then
        echo "--- :terraform: OpenTofu already installed, skipping"
        return
    fi
    echo "--- :terraform: Installing OpenTofu ${OPENTOFU_VERSION}"
    curl -fsSL https://get.opentofu.org/install-opentofu.sh | bash -s -- --install-method standalone --opentofu-version "${OPENTOFU_VERSION}"
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
    echo "--- :bun: Installing Bun ${BUN_VERSION}"
    curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
    export PATH="$HOME/.bun/bin:$PATH"
}

install_gh() {
    if command -v gh &>/dev/null; then
        echo "--- :github: GitHub CLI already installed, skipping"
        return
    fi
    echo "--- :github: Installing GitHub CLI ${GH_VERSION}"
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" | tar xz -C /tmp
    cp /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh /usr/local/bin/gh
    chmod +x /usr/local/bin/gh
    rm -rf /tmp/gh_*
}

install_shellcheck() {
    if command -v shellcheck &>/dev/null; then
        echo "--- :shell: shellcheck already installed, skipping"
        return
    fi
    echo "--- :shell: Installing shellcheck ${SHELLCHECK_VERSION}"
    curl -fsSL "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz" | tar xJ -C /tmp
    cp /tmp/shellcheck-v${SHELLCHECK_VERSION}/shellcheck /usr/local/bin/shellcheck
    chmod +x /usr/local/bin/shellcheck
}

install_target_determinator() {
    if command -v target-determinator &>/dev/null; then
        echo "--- :bazel: target-determinator already installed, skipping"
        return
    fi
    echo "--- :bazel: Installing target-determinator ${TARGET_DETERMINATOR_VERSION}"
    curl -fsSL "https://github.com/bazel-contrib/target-determinator/releases/download/v${TARGET_DETERMINATOR_VERSION}/target-determinator.linux.amd64" -o /usr/local/bin/target-determinator
    chmod +x /usr/local/bin/target-determinator
}

install_rust() {
    if command -v rustc &>/dev/null; then
        echo "--- :rust: Rust already installed, skipping"
        return
    fi
    echo "--- :rust: Installing Rust toolchain (rustup ${RUSTUP_VERSION})"
    curl -fsSL "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" -o /tmp/rustup-init
    chmod +x /tmp/rustup-init
    /tmp/rustup-init -y
    rm /tmp/rustup-init
    # shellcheck disable=SC1091 # runtime path, not available at lint time
    source "$HOME/.cargo/env"
    rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu
    apt-get install -y -qq gcc-aarch64-linux-gnu > /dev/null
}

# Auto-fix git alternates when sourced (every CI step gets a fresh clone)
fix_git_alternates
