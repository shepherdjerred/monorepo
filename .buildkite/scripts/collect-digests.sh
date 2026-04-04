#!/usr/bin/env bash
# Collect per-image digests from Buildkite metadata into a JSON file.
# Called by the version-commit-back CI step.
# Each image push step sets metadata at "digest:{versionKey}".
set -euo pipefail

OUTPUT="${1:-/tmp/digests.json}"

echo '{' > "$OUTPUT"
FIRST=1

for KEY in "$@"; do
  # Skip the first arg (output path)
  if [ "$KEY" = "$OUTPUT" ]; then continue; fi
  D=$(buildkite-agent meta-data get "digest:$KEY" --default "")
  if [ -z "$D" ]; then
    echo "ERROR: missing digest for key '$KEY' — upstream push step may have failed" >&2
    exit 1
  fi
  if [ "$FIRST" = "1" ]; then FIRST=0; else echo ',' >> "$OUTPUT"; fi
  printf '  "%s": "%s"' "$KEY" "$D" >> "$OUTPUT"
done

echo '' >> "$OUTPUT"
echo '}' >> "$OUTPUT"
cat "$OUTPUT"
