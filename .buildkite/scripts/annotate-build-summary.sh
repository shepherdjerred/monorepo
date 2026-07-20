#!/usr/bin/env bash
set -euo pipefail

# Main-build summary annotation: one pass/fail table across the deploy DAG,
# via Buildkite's step-outcome API (replaces the old build-summary step's
# meta-data plumbing). Runs with allow_dependency_failure so a red deploy
# still gets a summary.

STEPS=(verify playwright-e2e-main resume-build-main docker-e2e-main images sites helm-push tofu-apply argocd-sync)

{
  echo "### :rocket: main build summary"
  echo ""
  echo "| Step | Outcome |"
  echo "| --- | --- |"
  for step in "${STEPS[@]}"; do
    outcome=$(buildkite-agent step get "outcome" --step "$step")
    if [ "$outcome" = "passed" ]; then
      icon=":white_check_mark:"
    else
      icon=":x:"
    fi
    echo "| ${step} | ${icon} ${outcome} |"
  done
} | buildkite-agent annotate --style info --context build-summary
