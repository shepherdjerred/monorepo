#!/usr/bin/env bash
set -Eeuo pipefail

# Resolve the newest green main commit that is not this build's commit, then
# publish it once for every metadata-driven main-lane selector. This runs in
# the small ci-base pod because heavyweight runtime images intentionally do not
# carry the API tools used here. The pipeline marks this step soft-fail: if the
# lookup fails, ci-changed.sh cannot read the metadata and safely runs all lanes.

if [ -z "${BUILDKITE_API_TOKEN:-}" ]; then
  echo "BUILDKITE_API_TOKEN is required to resolve the CI selector base" >&2
  exit 2
fi

organization=${BUILDKITE_ORGANIZATION_SLUG:-sjerred}
pipeline=${BUILDKITE_PIPELINE_SLUG:-monorepo}
head_commit=${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}
response=$(curl -fsS --connect-timeout 5 --max-time 20 --retry 2 --retry-delay 1 \
  -H "Authorization: Bearer ${BUILDKITE_API_TOKEN}" \
  "https://api.buildkite.com/v2/organizations/${organization}/pipelines/${pipeline}/builds?branch=main&state=passed&per_page=20")
base=$(printf '%s' "$response" | jq -er --arg head "$head_commit" \
  '[.[] | .commit | select(type == "string" and length > 0 and . != $head)][0]')

git cat-file -e "${base}^{commit}"
git merge-base --is-ancestor "$base" HEAD
buildkite-agent meta-data set ci-changed-base "$base"
echo "CI selector base: ${base}"
