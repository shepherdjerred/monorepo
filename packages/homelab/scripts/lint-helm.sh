#!/usr/bin/env bash
set -e

# Get the repository root directory
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CDK8S_DIR="$REPO_ROOT/src/cdk8s"
HELM_DIR="$CDK8S_DIR/helm"

echo "🏗️  Building CDK8s manifests for Helm chart..."
cd "$CDK8S_DIR"
bun run build

echo ""
echo "🔍 Linting Helm charts..."

# Check if helm is available
if ! command -v helm &> /dev/null; then
    echo "⚠️  Helm not installed, skipping Helm lint"
    echo "   Install Helm: https://helm.sh/docs/intro/install/"
    exit 0
fi

# Lint each chart in the helm directory (per-chart directory structure)
for chart_dir in "$HELM_DIR"/*/; do
    chart_name=$(basename "$chart_dir")

    # Skip if not a directory or no Chart.yaml
    if [ ! -f "$chart_dir/Chart.yaml" ]; then
        continue
    fi

    echo ""
    echo "📦 Linting chart: $chart_name"

    # Create a temporary directory for this chart
    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TEMP_DIR"' EXIT

    # Copy chart files
    cp -r "$chart_dir"/* "$TEMP_DIR/"
    cd "$TEMP_DIR"

    # Set version using the same script that Dagger uses
    "$REPO_ROOT/scripts/helm-set-version.sh" Chart.yaml "0.0.0-lint"

    # Copy only this chart's CDK8s manifest into templates
    mkdir -p templates
    if [ -f "$CDK8S_DIR/dist/${chart_name}.k8s.yaml" ]; then
        cp "$CDK8S_DIR/dist/${chart_name}.k8s.yaml" templates/
    else
        echo "   ⚠️  No manifest found for $chart_name, skipping..."
        continue
    fi

    # Run helm lint
    helm lint .

    echo "   ✅ $chart_name lint passed!"

    # Clean up temp dir
    rm -rf "$TEMP_DIR"
    trap - EXIT
done

echo ""
echo "✅ All Helm charts lint passed!"
