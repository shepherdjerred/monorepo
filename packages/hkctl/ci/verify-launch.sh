#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${HKCTL_DEVELOPMENT_TEAM:-}" ]]; then
  echo "HKCTL_DEVELOPMENT_TEAM is required for a signed HomeKit launch smoke test." >&2
  exit 1
fi

xcodegen generate --spec project.yml
xcodebuild \
  -project hkctl.xcodeproj \
  -scheme hkctl \
  -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst,arch=arm64' \
  -derivedDataPath .build/xcode \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$HKCTL_DEVELOPMENT_TEAM" \
  CODE_SIGN_STYLE=Automatic \
  -quiet \
  build

package_path="$(pwd -P)"
app_path="$package_path/.build/xcode/Build/Products/Debug-maccatalyst/hkctl.app"
output_path="$package_path/.build/hkctl-smoke.out"

if [[ ! -d "$app_path" ]]; then
  echo "Expected Catalyst app at $app_path after a successful build." >&2
  exit 1
fi

rm -f "$output_path"
open -n "$app_path" --args --help --output "$output_path"

for _attempt in {1..50}; do
  if [[ -f "$output_path" ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -f "$output_path" ]]; then
  echo "hkctl launched but did not write $output_path." >&2
  exit 1
fi

if ! rg --quiet '^USAGE:' "$output_path"; then
  echo "hkctl launch output did not contain the expected help text." >&2
  exit 1
fi

echo "hkctl signed launch smoke test passed."
