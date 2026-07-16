#!/usr/bin/env bash
set -e

# Get the repository root directory
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CDK8S_DIR="$REPO_ROOT/src/cdk8s"
HELM_DIR="$CDK8S_DIR/helm"

# Build CDK8s manifests if dist/ doesn't exist.
# Note: homelab-typecheck runs in parallel and also builds dist/ — if both
# hooks race, the build's `rm -rf dist/` can delete manifests mid-lint.
# We build only if dist/ is missing, then verify each manifest below.
if [ ! -d "$CDK8S_DIR/dist" ] || [ -z "$(ls -A "$CDK8S_DIR/dist")" ]; then
    echo "🏗️  Building CDK8s manifests for Helm chart..."
    cd "$CDK8S_DIR"
    bun run build
else
    echo "🏗️  Using existing CDK8s dist/ (already built)"
fi

echo ""
echo "🔍 Linting Helm charts..."

# Check if helm is available
if ! command -v helm &> /dev/null; then
    echo "ERROR: Helm not installed. Required for linting."
    echo "   Install Helm: https://helm.sh/docs/intro/install/"
    exit 1
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

    # Copy chart files
    cp -r "$chart_dir"/* "$TEMP_DIR/"

    # Set version using the same script that Dagger uses
    "$REPO_ROOT/scripts/helm-set-version.sh" "$TEMP_DIR/Chart.yaml" "0.0.0-lint"

    # Copy this chart's CDK8s manifest into templates.
    # Retry briefly — homelab-typecheck may be rebuilding dist/ in parallel.
    mkdir -p "$TEMP_DIR/templates"
    MANIFEST="$CDK8S_DIR/dist/${chart_name}.k8s.yaml"
    for attempt in 1 2 3 4 5; do
        if [ -f "$MANIFEST" ]; then
            break
        fi
        if [ "$attempt" -eq 5 ]; then
            echo "   ❌ No manifest found for $chart_name after retries"
            echo "   Ensure the chart is registered in setup-charts.ts and bun run build succeeds"
            rm -rf "$TEMP_DIR"
            exit 1
        fi
        sleep 1
    done
    cp "$MANIFEST" "$TEMP_DIR/templates/"

    # Run helm lint
    helm lint "$TEMP_DIR"

    echo "   ✅ $chart_name lint passed!"

    # Clean up temp dir
    rm -rf "$TEMP_DIR"
done

echo ""
echo "✅ All Helm charts lint passed!"
