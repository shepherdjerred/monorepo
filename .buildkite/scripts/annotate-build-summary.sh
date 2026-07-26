#!/usr/bin/env bash
set -euo pipefail

# Main-build summary annotation: one pass/fail table across the deploy DAG,
# via Buildkite's step-outcome API (replaces the old build-summary step's
# meta-data plumbing). Runs with allow_dependency_failure so a red deploy
# still gets a summary.

STEPS=(verify playwright-e2e-main resume-build-main docker-e2e-main images sites helm-push tofu-apply argocd-sync)

# Every ci-changed.sh lane records its run/skip decision (with evidence) as
# `ci-lane-decision-<lane>` meta-data; render them all in one table so the
# build page explains what ran and why. Keep in sync with the lane `case` in
# ci-changed.sh — the lane-coverage test asserts the lists match.
LANES=(
  playwright resume docker-e2e images
  sites site-sjer-red site-resume site-webring site-cooklang site-stocks
  site-better-skill-capped site-glitter site-scout
  helm tofu argocd helm-types npm cooklang scout-reconcile ci-image
)

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
  echo ""
  echo "**Lane decisions**"
  echo ""
  echo "| Lane | Decision |"
  echo "| --- | --- |"
  for lane in "${LANES[@]}"; do
    decision=$(buildkite-agent meta-data get "ci-lane-decision-${lane}" --default "— (not recorded)")
    echo "| ${lane} | ${decision} |"
  done
} | buildkite-agent annotate --style info --context build-summary
