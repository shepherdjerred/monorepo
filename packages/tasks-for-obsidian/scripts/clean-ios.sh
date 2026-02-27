#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Cleaning iOS build artifacts..."
rm -rf ios/build
rm -rf ios/Pods
rm -rf ~/Library/Developer/Xcode/DerivedData/TasksForObsidian-*

echo "Reinstalling pods..."
cd ios && pod install

echo "Done. Run: bun run ios"
