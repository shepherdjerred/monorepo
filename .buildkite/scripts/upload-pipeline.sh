#!/bin/sh
set -eu

# Buildkite's native changed-file calculation enables rename detection, which
# reports only the destination path. A file moved out of a gated package can
# therefore hide the source lane. Supply an explicit --no-renames diff so a
# rename is represented as a deletion plus an addition. Any uncertainty writes
# the global CI path, deliberately scheduling every path-gated lane.

changed_files=$(mktemp "${TMPDIR:-/tmp}/buildkite-changed-files.XXXXXX")
trap 'rm -f "$changed_files"' EXIT

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=.buildkite/scripts/ci-image-refs.sh
. "$SCRIPT_DIR/ci-image-refs.sh"

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

# Mirror-health guard (2026-08-02 incident): CI checkouts are reference clones
# against the shared git mirror, so the alternates file points into
# /buildkite/git-mirrors. If that volume is missing or unreadable in this
# container, git object lookups silently fall back to full network transfer:
# the base fetch below downloads the entire repository pack into the
# memory-backed workspace and the container is OOM-killed. A broken alternate
# must never be a quiet slow path — degrade loudly to scheduling every lane.
broken_alternate=""
alternates_file=$(git rev-parse --git-path objects/info/alternates)
objects_dir=$(git rev-parse --git-path objects)
if [ -f "$alternates_file" ]; then
  while IFS= read -r alternate || [ -n "$alternate" ]; do
    case "$alternate" in
      "" | "#"*) continue ;;
      /*) alternate_dir=$alternate ;;
      *) alternate_dir="$objects_dir/$alternate" ;;
    esac
    if [ ! -d "$alternate_dir" ] || [ ! -r "$alternate_dir" ]; then
      broken_alternate=$alternate_dir
      break
    fi
  done < "$alternates_file"
fi

if [ -n "$broken_alternate" ]; then
  fail_open "git alternate object directory ${broken_alternate} is not readable (git-mirrors volume missing?)"
elif [ -n "${CI_CHANGED_FILES_BASE:-}" ]; then
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
