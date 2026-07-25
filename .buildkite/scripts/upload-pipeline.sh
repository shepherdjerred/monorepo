#!/bin/sh
set -eu

# Buildkite's native changed-file calculation enables rename detection, which
# reports only the destination path. A file moved out of a gated package can
# therefore hide the source lane. Supply an explicit --no-renames diff so a
# rename is represented as a deletion plus an addition. Any uncertainty writes
# the global CI path, deliberately scheduling every path-gated lane.

changed_files=$(mktemp "${TMPDIR:-/tmp}/buildkite-changed-files.XXXXXX")
trap 'rm -f "$changed_files"' EXIT

fail_open() {
  echo "WARN: $1; scheduling every path-gated lane" >&2
  printf '.buildkite/pipeline.yml\n' > "$changed_files"
}

write_changed_files() {
  base=$1
  if ! git cat-file -e "${base}^{commit}"; then
    fail_open "changed-file base ${base} is unavailable"
    return
  fi
  if ! git merge-base --is-ancestor "$base" HEAD; then
    fail_open "changed-file base ${base} is not an ancestor of HEAD"
    return
  fi
  if ! git diff --no-renames --name-only "$base" HEAD > "$changed_files"; then
    fail_open "git diff failed"
  fi
}

if [ -n "${CI_CHANGED_FILES_BASE:-}" ]; then
  write_changed_files "$CI_CHANGED_FILES_BASE"
elif [ "${BUILDKITE_PULL_REQUEST:-false}" = "false" ]; then
  fail_open "build is not associated with a pull request"
elif [ -z "${BUILDKITE_PULL_REQUEST_BASE_BRANCH:-}" ]; then
  fail_open "pull-request base branch is unavailable"
elif ! git check-ref-format --branch "$BUILDKITE_PULL_REQUEST_BASE_BRANCH" >/dev/null; then
  fail_open "pull-request base branch is invalid"
elif git fetch --no-tags origin \
  "refs/heads/${BUILDKITE_PULL_REQUEST_BASE_BRANCH}:refs/remotes/origin/${BUILDKITE_PULL_REQUEST_BASE_BRANCH}"; then
  if base=$(git merge-base "origin/${BUILDKITE_PULL_REQUEST_BASE_BRANCH}" HEAD); then
    write_changed_files "$base"
  else
    fail_open "pull-request merge base could not be resolved"
  fi
else
  fail_open "pull-request base branch could not be fetched"
fi

buildkite-agent pipeline upload --changed-files-path "$changed_files"
