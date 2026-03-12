#!/bin/bash

set -euxo pipefail

pkill firefox || true
bun packages/backend/dist/index.js
