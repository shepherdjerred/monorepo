#!/bin/bash
set -e

source dev-container-features-test-lib

check "earthly is installed to a different location" bash -c "which earthly | grep '/usr/bin'"

reportResults
