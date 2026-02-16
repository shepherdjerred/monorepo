#!/usr/bin/env bash
# Shared script to set Helm chart version
# Used by both Dagger CI pipeline and pre-commit hooks
#
# Usage: helm-set-version.sh <chart-yaml-path> <version>

set -e

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <chart-yaml-path> <version>"
    exit 1
fi

CHART_YAML="$1"
VERSION="$2"

if [ ! -f "$CHART_YAML" ]; then
    echo "Error: Chart.yaml not found at $CHART_YAML"
    exit 1
fi

# Update Chart.yaml version and appVersion
# This matches the logic used in .dagger/src/helm.ts
sed -i.bak "s/^version:.*$/version: ${VERSION}/" "$CHART_YAML"
sed -i.bak "s/^appVersion:.*$/appVersion: ${VERSION}/" "$CHART_YAML"
rm -f "${CHART_YAML}.bak"
