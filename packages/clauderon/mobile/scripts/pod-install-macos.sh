#!/bin/bash
# Script to install CocoaPods for macOS
# Temporarily removes react-native's codegenConfig to avoid collision with react-native-macos
# Uses Old Architecture for macOS builds

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RN_PACKAGE_JSON="$PROJECT_DIR/node_modules/react-native/package.json"
RN_PACKAGE_JSON_BACKUP="$PROJECT_DIR/node_modules/react-native/package.json.backup"

# Function to restore the backup on exit
cleanup() {
    if [ -f "$RN_PACKAGE_JSON_BACKUP" ]; then
        echo "Restoring react-native package.json..."
        mv "$RN_PACKAGE_JSON_BACKUP" "$RN_PACKAGE_JSON"
    fi
}
trap cleanup EXIT

# Backup react-native package.json
echo "Backing up react-native package.json..."
cp "$RN_PACKAGE_JSON" "$RN_PACKAGE_JSON_BACKUP"

# Remove codegenConfig from react-native's package.json
echo "Removing codegenConfig from react-native (to avoid collision with react-native-macos)..."
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$RN_PACKAGE_JSON', 'utf8'));
delete pkg.codegenConfig;
fs.writeFileSync('$RN_PACKAGE_JSON', JSON.stringify(pkg, null, 2));
"

# Run pod install with Old Architecture
echo "Running pod install (Old Architecture)..."
cd "$PROJECT_DIR/macos"
export RCT_NEW_ARCH_ENABLED=0
pod install "$@"

echo "macOS pod install completed successfully!"
