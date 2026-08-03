#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=.buildkite/scripts/ci-image-refs.sh
. "$SCRIPT_DIR/ci-image-refs.sh"

buildkite-agent pipeline upload .buildkite/reporting-pipeline.yml
