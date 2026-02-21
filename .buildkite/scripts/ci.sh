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
dagger version

# Connect to remote Dagger engine
echo "--- :kubernetes: Connecting to Dagger engine"
DAGGER_ENGINE_POD_NAME="$(kubectl get pod \
  --selector=name=dagger-dagger-helm-engine \
  --namespace=dagger \
  --output=jsonpath='{.items[0].metadata.name}')"
export _EXPERIMENTAL_DAGGER_RUNNER_HOST="kube-pod://${DAGGER_ENGINE_POD_NAME}?namespace=dagger"
echo "Using Dagger engine: ${DAGGER_ENGINE_POD_NAME}"

# Install Dagger module dependencies
echo "--- :bun: Installing Dagger module dependencies"
cd .dagger && bun install --frozen-lockfile && cd ..

# Build Dagger CI args
echo "+++ :dagger: Running Dagger CI pipeline"
ARGS=(
  --source=.
  --branch="${BUILDKITE_BRANCH}"
  --github-token=env:GH_TOKEN
  --npm-token=env:NPM_TOKEN
  --s3-access-key-id=env:S3_ACCESS_KEY_ID
  --s3-secret-access-key=env:S3_SECRET_ACCESS_KEY
)

if [[ "${BUILDKITE_BRANCH}" == "main" ]]; then
  ARGS+=(
    --version="1.0.${BUILDKITE_BUILD_NUMBER}"
    --git-sha="${BUILDKITE_COMMIT}"
    --registry-username=shepherdjerred
    --registry-password=env:GH_TOKEN
    --commit-back-token=env:GH_TOKEN
    --argocd-token=env:ARGOCD_TOKEN
    --chart-museum-username=env:CHARTMUSEUM_USERNAME
    --chart-museum-password=env:CHARTMUSEUM_PASSWORD
    --cloudflare-api-token=env:CLOUDFLARE_API_TOKEN
    --cloudflare-account-id=env:CLOUDFLARE_ACCOUNT_ID
    --hass-base-url=env:HASS_BASE_URL
    --hass-token=env:HASS_TOKEN
    --tofu-github-token=env:TOFU_GITHUB_TOKEN
  )
fi

MAX_RETRIES=5
RETRY=0
until dagger -v call ci "${ARGS[@]}"; do
  RETRY=$((RETRY + 1))
  if [ "${RETRY}" -ge "${MAX_RETRIES}" ]; then
    echo "Dagger CI failed after ${MAX_RETRIES} attempts"
    exit 1
  fi
  DELAY=$((10 + RETRY * 10))
  echo "Dagger CI failed (attempt ${RETRY}/${MAX_RETRIES}), retrying in ${DELAY}s..."
  sleep "${DELAY}"
done
