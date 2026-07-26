#!/usr/bin/env bash
set -euo pipefail

# Main-build summary annotation: one pass/fail table across the deploy DAG,
# via Buildkite's step-outcome API (replaces the old build-summary step's
# meta-data plumbing). Runs with allow_dependency_failure so a red deploy
# still gets a summary.

STEPS=(
  verify playwright-e2e-main resume-build-main docker-e2e-main images sites
  helm-push tofu-apply argocd-sync publish scout-prod-reconcile ci-image-refresh
)

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

# helm-types is gated by ci-changed.sh but only ever invoked by the PR-only
# pr-dryrun step (main is skipped by design — see pipeline.yml's pr-dryrun
# comment). Its decision meta-data is correctly absent on every main build;
# say so explicitly instead of the generic "not recorded", which reads like
# the other lanes' race-condition gap this table used to have.
PR_ONLY_LANES=(helm-types)

is_pr_only_lane() {
  local lane="$1" pr_lane
  for pr_lane in "${PR_ONLY_LANES[@]}"; do
    [ "$lane" = "$pr_lane" ] && return 0
  done
  return 1
}

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
    if is_pr_only_lane "$lane"; then
      default="n/a — PR-only gate (pr-dryrun), not run on main"
    else
      default="— (not recorded)"
    fi
    decision=$(buildkite-agent meta-data get "ci-lane-decision-${lane}" --default "$default")
    echo "| ${lane} | ${decision} |"
  done
} | buildkite-agent annotate --style info --context build-summary
