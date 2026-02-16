#!/bin/bash

set -euxo pipefail

pkill firefox || true
node packages/backend/dist/index.js
