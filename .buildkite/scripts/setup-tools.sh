#!/usr/bin/env bash
# Common tool installation for CI scripts.
# Source this file: source "$(dirname "$0")/setup-tools.sh"
set -euo pipefail

# renovate: datasource=github-releases depName=BurntSushi/ripgrep
RIPGREP_VERSION="15.1.0"

# renovate: datasource=github-releases depName=kubernetes/kubernetes
KUBECTL_VERSION="v1.36.0"

# renovate: datasource=github-releases depName=koalaman/shellcheck
SHELLCHECK_VERSION="0.11.0"

# renovate: datasource=github-releases depName=astral-sh/uv
UV_VERSION="0.11.7"

# renovate: datasource=github-releases depName=helm/helm
HELM_VERSION="v4.1.4"

# renovate: datasource=github-tags depName=aws/aws-cli versioning=semver
AWSCLI_VERSION="2.34.35"

# renovate: datasource=github-releases depName=opentofu/opentofu
OPENTOFU_VERSION="1.11.6"

# renovate: datasource=github-releases depName=oven-sh/bun
BUN_VERSION="1.3.13"

# renovate: datasource=github-releases depName=cli/cli
GH_VERSION="2.91.0"

# renovate: datasource=github-tags depName=rust-lang/rustup versioning=semver
RUSTUP_VERSION="1.29.0"

# renovate: datasource=github-releases depName=gitleaks/gitleaks
GITLEAKS_VERSION="8.30.1"

# renovate: datasource=github-releases depName=aquasecurity/trivy
TRIVY_VERSION="0.70.0"

# renovate: datasource=pypi depName=semgrep
SEMGREP_VERSION="1.161.0"


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

install_gitleaks() {
    if command -v gitleaks &>/dev/null; then
        echo "--- :lock: gitleaks already installed, skipping"
        return
    fi
    echo "--- :lock: Installing gitleaks ${GITLEAKS_VERSION}"
    curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" | tar xz -C /tmp
    cp /tmp/gitleaks /usr/local/bin/gitleaks
    chmod +x /usr/local/bin/gitleaks
}

install_trivy() {
    if command -v trivy &>/dev/null; then
        echo "--- :shield: trivy already installed, skipping"
        return
    fi
    echo "--- :shield: Installing trivy ${TRIVY_VERSION}"
    curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" | tar xz -C /tmp
    cp /tmp/trivy /usr/local/bin/trivy
    chmod +x /usr/local/bin/trivy
}

install_semgrep() {
    if command -v semgrep &>/dev/null; then
        echo "--- :mag: semgrep already installed, skipping"
        return
    fi
    echo "--- :mag: Installing semgrep ${SEMGREP_VERSION}"
    install_uv
    uv tool install --python 3.12 "semgrep==${SEMGREP_VERSION}" --with setuptools
    export PATH="$HOME/.local/bin:$PATH"
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
