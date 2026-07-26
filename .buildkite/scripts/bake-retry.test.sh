#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=.buildkite/scripts/bake-retry.sh
source "${SCRIPT_DIR}/bake-retry.sh"

FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT

printf 'unexpected EOF\n' > "$FIXTURE/buildx-import-panic.log"
for frame in $(seq 1 150); do
  printf 'github.com/docker/buildx/import/frame-%s\n' "$frame"
done >> "$FIXTURE/buildx-import-panic.log"
printf 'panic: send on closed channel\n' >> "$FIXTURE/buildx-import-panic.log"

if ! bake_failure_is_transient "$FIXTURE/buildx-import-panic.log"; then
  echo "Buildx import panic was not classified as transient" >&2
  exit 1
fi

printf 'unexpected EOF\n' > "$FIXTURE/eof.log"
if ! bake_failure_is_transient "$FIXTURE/eof.log"; then
  echo "unexpected EOF was not classified as transient" >&2
  exit 1
fi

printf 'target birmel: failed to receive status: rpc error: code = Unavailable desc = error reading from server: EOF\n' > "$FIXTURE/remote-driver-drop.log"
if ! bake_failure_is_transient "$FIXTURE/remote-driver-drop.log"; then
  echo "remote BuildKit driver drop was not classified as transient" >&2
  exit 1
fi

printf 'failed to solve: missing COPY source\n' > "$FIXTURE/build-error.log"
if bake_failure_is_transient "$FIXTURE/build-error.log"; then
  echo "deterministic build error was classified as transient" >&2
  exit 1
fi

printf 'panic: index out of range\n' > "$FIXTURE/unrelated-panic.log"
if bake_failure_is_transient "$FIXTURE/unrelated-panic.log"; then
  echo "unrelated panic was classified as transient" >&2
  exit 1
fi

echo "image bake retry classifier tests passed"
