#!/bin/sh

read_ci_image_ref() {
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

CI_BASE_IMAGE=$(read_ci_image_ref \
  ghcr.io/shepherdjerred/ci-base \
  ci/ci-image/DIGEST)
CI_PLAYWRIGHT_IMAGE=$(read_ci_image_ref \
  ghcr.io/shepherdjerred/ci-playwright \
  ci/ci-playwright/DIGEST)
export CI_BASE_IMAGE CI_PLAYWRIGHT_IMAGE

# The windows-cross-compiler images have no pin until their first promotion
# merges; steps that run in them are added once the pins exist.
windows_cross_pins=packages/windows-cross-compiler/images
if [ -f "$windows_cross_pins/windows-cross-compiler/DIGEST" ]; then
  WINDOWS_CROSS_COMPILER_IMAGE=$(read_ci_image_ref \
    ghcr.io/shepherdjerred/windows-cross-compiler \
    "$windows_cross_pins/windows-cross-compiler/DIGEST")
  export WINDOWS_CROSS_COMPILER_IMAGE
fi
if [ -f "$windows_cross_pins/windows-cross-compiler-winui/DIGEST" ]; then
  WINDOWS_CROSS_COMPILER_WINUI_IMAGE=$(read_ci_image_ref \
    ghcr.io/shepherdjerred/windows-cross-compiler-winui \
    "$windows_cross_pins/windows-cross-compiler-winui/DIGEST")
  export WINDOWS_CROSS_COMPILER_WINUI_IMAGE
fi
