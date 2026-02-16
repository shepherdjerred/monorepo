#!/bin/bash

set -euxo pipefail

rm -rf assets/presets/*

npx tsx src/presets/renderExamples.ts

# look up the files in assets/presets/
# save the list as JSON
export presets=$(ls assets/presets/ | jq -R . | jq -s .)

# pass the JSON list directly into gomplate
gomplate -f README.md.tmpl -d presets=env:///presets?type=application/json > README.md
