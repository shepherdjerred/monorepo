#!/usr/bin/env bash
# Common tool installation for CI scripts.
# Source this file: source "$(dirname "$0")/setup-tools.sh"
set -euo pipefail

BAZELISK_VERSION="1.25.0"

install_base() {
    echo "--- :debian: Installing system dependencies"
    apt-get update -qq && apt-get install -y -qq curl jq > /dev/null
}

install_bazel() {
    echo "--- :bazel: Installing Bazelisk ${BAZELISK_VERSION}"
    curl -fsSL "https://github.com/bazelbuild/bazelisk/releases/download/v${BAZELISK_VERSION}/bazelisk-linux-amd64" -o /usr/local/bin/bazel
    chmod +x /usr/local/bin/bazel
}

install_uv() {
    echo "--- :python: Installing uv"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
}

install_kubectl() {
    local kubectl_version="v1.34.1"
    echo "--- :kubectl: Installing kubectl ${kubectl_version}"
    curl -fsSL "https://dl.k8s.io/release/${kubectl_version}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl
    chmod +x /usr/local/bin/kubectl
}

install_helm() {
    echo "--- :helm: Installing Helm"
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
}

install_awscli() {
    echo "--- :aws: Installing AWS CLI"
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -q awscliv2.zip
    ./aws/install
    rm -rf awscliv2.zip aws
}

install_tofu() {
    echo "--- :terraform: Installing OpenTofu"
    curl -fsSL https://get.opentofu.org/install-opentofu.sh | bash -s -- --install-method standalone
}

install_node() {
    echo "--- :nodejs: Installing Node.js"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs > /dev/null
}

install_bun() {
    echo "--- :bun: Installing Bun"
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
}

install_gh() {
    echo "--- :github: Installing GitHub CLI"
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    apt-get update -qq && apt-get install -y -qq gh > /dev/null
}

install_target_determinator() {
    local version="0.32.0"
    echo "--- :bazel: Installing target-determinator ${version}"
    curl -fsSL "https://github.com/bazel-contrib/target-determinator/releases/download/v${version}/target-determinator.linux.amd64" -o /usr/local/bin/target-determinator
    chmod +x /usr/local/bin/target-determinator
}
