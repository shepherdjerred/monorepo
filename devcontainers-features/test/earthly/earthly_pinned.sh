#!/bin/bash
set -e

source dev-container-features-test-lib

check "earthly can be pinned to a specific version" bash -c "earthly --version | grep 'v0.7.0'"

reportResults
