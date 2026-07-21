#!/usr/bin/env bash
set -euo pipefail

target=${1:-}
if [ -z "$target" ] || [ "$#" -ne 1 ]; then
  echo "Usage: run-buildx-io-fixture.sh <bake-target>" >&2
  exit 2
fi

benchmark_id=${CI_IO_BUILDX_BENCHMARK_ID:?CI_IO_BUILDX_BENCHMARK_ID is required}
case "${CI_IO_BUILDX_BENCHMARK_MODE:-}" in
  baseline)
    export CI_BUILDX_MODE=docker-container
    export CI_BUILDX_REQUIRE_LEGACY_STORE=true
    ;;
  candidate)
    export CI_BUILDX_MODE=containerd-default
    export CI_BUILDX_REQUIRE_LEGACY_STORE=false
    ;;
  *)
    echo "CI_IO_BUILDX_BENCHMARK_MODE must be baseline or candidate" >&2
    exit 2
    ;;
esac

# A shared value prevents Buildkite's different baseline/candidate build
# numbers from changing image config. Disable both registry cache import and
# export: mutable :buildcache refs could otherwise change between the two
# builds and be falsely credited to the candidate driver.
export CI_IMAGE_VERSION="$benchmark_id"
export CI_BUILDX_READ_CACHE=false
export CI_BUILDX_METADATA_PATH=buildx-run-metadata.json
bash .buildkite/scripts/bake-images.sh --target "$target"
