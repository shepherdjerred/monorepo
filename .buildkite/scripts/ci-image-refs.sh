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
  packages/homelab/src/cdk8s/src/resources/argo-applications/ci-base.DIGEST)
CI_PLAYWRIGHT_IMAGE=$(read_ci_image_ref \
  ghcr.io/shepherdjerred/ci-playwright \
  .buildkite/ci-playwright/DIGEST)
export CI_BASE_IMAGE CI_PLAYWRIGHT_IMAGE
