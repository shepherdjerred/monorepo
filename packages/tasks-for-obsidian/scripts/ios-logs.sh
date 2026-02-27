#!/bin/bash
# Stream iOS simulator logs filtered to TasksForObsidian
# Usage: ./scripts/ios-logs.sh [output-file]
OUT="${1:-/tmp/device.log}"
echo "Streaming device logs to $OUT (Ctrl+C to stop)"
xcrun simctl spawn booted log stream \
  --predicate 'process == "TasksForObsidian"' \
  --level debug 2>&1 | tee "$OUT"
