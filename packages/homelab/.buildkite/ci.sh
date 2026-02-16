#!/usr/bin/env bash
set -euo pipefail

# Buildkite CI script for homelab
# Runs the Dagger CI pipeline in dev mode (checks/tests only, no publishing)

# --- Install kubectl ---
KUBECTL_VERSION=$(grep -o '"kubernetes/kubernetes": "[^"]*"' src/cdk8s/src/versions.ts | sed 's/.*: "//;s/"//')
echo "--- Installing kubectl ${KUBECTL_VERSION}"
curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
chmod +x /usr/local/bin/kubectl

# --- Discover Dagger engine pod ---
echo "--- Discovering Dagger engine"
DAGGER_ENGINE_POD_NAME=$(kubectl get pod \
  --selector=name=dagger-dagger-helm-engine \
  --namespace=dagger \
  --output=jsonpath='{.items[0].metadata.name}')

DAGGER_IMAGE=$(kubectl get pod \
  --selector=name=dagger-dagger-helm-engine \
  --namespace=dagger \
  -o jsonpath='{.items[0].spec.containers[0].image}')
DAGGER_VERSION="${DAGGER_IMAGE##*:v}"

echo "Dagger engine pod: ${DAGGER_ENGINE_POD_NAME}"
echo "Dagger version: ${DAGGER_VERSION}"

# --- Install Dagger CLI ---
echo "--- Installing Dagger CLI ${DAGGER_VERSION}"
curl -fsSL https://dl.dagger.io/dagger/install.sh | DAGGER_VERSION="${DAGGER_VERSION}" BIN_DIR="/usr/local/bin" sh

# --- Set runner host ---
export _EXPERIMENTAL_DAGGER_RUNNER_HOST="kube-pod://${DAGGER_ENGINE_POD_NAME}?namespace=dagger"

# --- Run Dagger CI pipeline (dev mode) ---
echo "--- Running Dagger CI pipeline (dev mode)"
dagger call ci \
  --source=. \
  --argocd-token "dummy" \
  --ghcr-username "dummy" \
  --ghcr-password "dummy" \
  --chart-version "dummy" \
  --chart-museum-username "dummy" \
  --chart-museum-password "dummy" \
  --hass-base-url "https://homeassistant.tailnet-1a49.ts.net" \
  --hass-token env://HASS_TOKEN \
  --env dev
