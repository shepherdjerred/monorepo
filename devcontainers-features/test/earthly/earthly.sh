#!/bin/bash
set -e

source dev-container-features-test-lib

check "earthly can be executed" bash -c "earthly --version"

reportResults
