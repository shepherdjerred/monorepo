#!/bin/sh
set -eu

# Buildkite's native changed-file calculation enables rename detection, which
# reports only the destination path. A file moved out of a gated package can
# therefore hide the source lane. Supply an explicit --no-renames diff so a
# rename is represented as a deletion plus an addition. Any uncertainty writes
# the global CI path, deliberately scheduling every path-gated lane.

changed_files=$(mktemp "${TMPDIR:-/tmp}/buildkite-changed-files.XXXXXX")
trap 'rm -f "$changed_files"' EXIT

read_image_ref() {
  image=$1
  digest_file=$2
  if [ ! -f "$digest_file" ]; then
    echo "missing CI image digest file: $digest_file" >&2
    exit 1
  fi
  digest=$(cat "$digest_file")
  hex=${digest#sha256:}
  if [ "$digest" = "$hex" ] || [ "${#hex}" -ne 64 ]; then
    echo "invalid CI image digest in $digest_file" >&2
    exit 1
  fi
  case "$hex" in
    *[!0-9a-f]*)
      echo "invalid CI image digest in $digest_file" >&2
      exit 1
      ;;
  esac
  printf '%s@%s\n' "$image" "$digest"
}

CI_BASE_IMAGE=$(read_image_ref \
  ghcr.io/shepherdjerred/ci-base \
  packages/homelab/src/cdk8s/src/resources/argo-applications/ci-base.DIGEST)
CI_PLAYWRIGHT_IMAGE=$(read_image_ref \
  ghcr.io/shepherdjerred/ci-playwright \
  .buildkite/ci-playwright/DIGEST)
export CI_BASE_IMAGE CI_PLAYWRIGHT_IMAGE

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
