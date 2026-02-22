#!/usr/bin/env bash
set -euo pipefail

# Install system dependencies
echo "--- :debian: Installing system dependencies"
apt-get update -qq && apt-get install -y -qq curl jq > /dev/null

# Install kubectl
KUBECTL_VERSION="v1.34.1"
echo "--- :kubectl: Installing kubectl ${KUBECTL_VERSION}"
curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl
chmod +x /usr/local/bin/kubectl

# Install Dagger CLI (version from dagger.json)
DAGGER_VERSION=$(jq -r '.engineVersion' dagger.json | sed 's/^v//')
echo "--- :dagger: Installing Dagger CLI ${DAGGER_VERSION}"
if ! curl -fsSL https://dl.dagger.io/dagger/install.sh | DAGGER_VERSION="${DAGGER_VERSION}" BIN_DIR="/usr/local/bin" sh; then
  echo "Primary source failed, trying GitHub releases..."
  curl -fsSL "https://github.com/dagger/dagger/releases/download/v${DAGGER_VERSION}/dagger_v${DAGGER_VERSION}_linux_amd64.tar.gz" | tar xz -C /usr/local/bin
  chmod +x /usr/local/bin/dagger
fi

# Connect to remote Dagger engine
echo "--- :kubernetes: Connecting to Dagger engine"
DAGGER_ENGINE_POD_NAME="$(kubectl get pod \
  --selector=name=dagger-dagger-helm-engine \
  --namespace=dagger \
  --output=jsonpath='{.items[0].metadata.name}')"
export _EXPERIMENTAL_DAGGER_RUNNER_HOST="kube-pod://${DAGGER_ENGINE_POD_NAME}?namespace=dagger"

# Install Dagger module dependencies
echo "--- :bun: Installing Dagger module dependencies"
cd .dagger && bun install --frozen-lockfile && cd ..

echo "+++ :robot_face: Running code review"
dagger call code-review \
  --source=. \
  --github-token=env:GH_TOKEN \
  --claude-oauth-token=env:CLAUDE_CODE_OAUTH_TOKEN \
  --pr-number="${BUILDKITE_PULL_REQUEST}" \
  --base-branch="${BUILDKITE_PULL_REQUEST_BASE_BRANCH}" \
  --head-sha="${BUILDKITE_COMMIT}"
