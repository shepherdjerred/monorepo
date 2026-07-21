#!/usr/bin/env bash
set -euo pipefail

# Select the Buildx builder without changing the default CI behavior.
#
# docker-container: the current production path. BuildKit runs in its own
# container and exports registry cache.
# containerd-default: the benchmark candidate. Docker's default builder is
# valid only when the daemon exposes the containerd image store, avoiding the
# separate BuildKit-to-Docker load while retaining registry-cache support.
#
# The selected builder name is the only stdout output so callers can capture it.

mode="${CI_BUILDX_MODE:-docker-container}"
require_legacy_store="${CI_BUILDX_REQUIRE_LEGACY_STORE:-false}"

case "$require_legacy_store" in
  true | false) ;;
  *)
    echo "CI_BUILDX_REQUIRE_LEGACY_STORE must be true or false" >&2
    exit 2
    ;;
esac

has_containerd_image_store() {
  jq -e '
    type == "array"
    and any(.[];
      type == "array"
      and length == 2
      and .[0] == "driver-type"
      and .[1] == "io.containerd.snapshotter.v1"
    )
  ' >/dev/null
}

case "$mode" in
  docker-container)
    if [ "$require_legacy_store" = true ]; then
      driver_status=$(docker info --format '{{json .DriverStatus}}')
      if has_containerd_image_store <<<"$driver_status"; then
        echo "docker-container baseline requires Docker's legacy image store" >&2
        exit 1
      fi
    fi
    builder_name="${CI_BUILDX_BUILDER_NAME:-ci}"
    builders=$(docker buildx ls --format '{{.Name}}')
    if ! awk -v expected="$builder_name" '$1 == expected { found = 1 } END { exit found ? 0 : 1 }' <<<"$builders"; then
      created=$(docker buildx create --name "$builder_name" --driver docker-container)
      if [ "$created" != "$builder_name" ]; then
        echo "Buildx created unexpected builder '$created' instead of '$builder_name'" >&2
        exit 1
      fi
    fi
    printf '%s\n' "$builder_name"
    ;;
  containerd-default)
    driver_status=$(docker info --format '{{json .DriverStatus}}')
    if ! has_containerd_image_store <<<"$driver_status"; then
      echo "containerd-default requires Docker's containerd image store" >&2
      exit 1
    fi

    default_details=$(docker buildx inspect default)
    default_driver=$(awk '$1 == "Driver:" { print $2 }' <<<"$default_details")
    if [ "$default_driver" != "docker" ]; then
      echo "default Buildx builder uses '$default_driver', expected 'docker'" >&2
      exit 1
    fi
    printf 'default\n'
    ;;
  *)
    echo "unknown CI_BUILDX_MODE '$mode'" >&2
    exit 2
    ;;
esac
