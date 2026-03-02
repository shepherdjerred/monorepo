#!/bin/bash
# Workspace status command for Bazel stamping
# https://bazel.build/docs/user-manual#workspace-status

echo "STABLE_GIT_SHA $(git rev-parse HEAD)"
echo "STABLE_GIT_BRANCH $(git rev-parse --abbrev-ref HEAD)"
# Buildkite-specific (available in CI)
if [ -n "${BUILDKITE_BUILD_NUMBER:-}" ]; then
  echo "STABLE_BUILD_NUMBER ${BUILDKITE_BUILD_NUMBER}"
fi
if [ -n "${BUILDKITE_COMMIT:-}" ]; then
  echo "STABLE_BUILDKITE_COMMIT ${BUILDKITE_COMMIT}"
fi
