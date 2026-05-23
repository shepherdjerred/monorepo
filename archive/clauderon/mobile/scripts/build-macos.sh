#!/bin/bash
# Script to build the macOS app
# Temporarily removes react-native's codegenConfig to avoid collision with react-native-macos
# Uses Old Architecture for macOS builds (New Architecture not supported due to codegen conflicts)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RN_PACKAGE_JSON="$PROJECT_DIR/node_modules/react-native/package.json"
RN_PACKAGE_JSON_BACKUP="$PROJECT_DIR/node_modules/react-native/package.json.backup"

# Parse command line arguments
SKIP_POD_INSTALL=false
RUN_APP=false
CONFIGURATION="Debug"

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-pod-install)
            SKIP_POD_INSTALL=true
            shift
            ;;
        --run)
            RUN_APP=true
            shift
            ;;
        --release)
            CONFIGURATION="Release"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--skip-pod-install] [--run] [--release]"
            exit 1
            ;;
    esac
done

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

# Set Old Architecture
export RCT_NEW_ARCH_ENABLED=0

# Run pod install if not skipped
if [ "$SKIP_POD_INSTALL" = false ]; then
    echo "Running pod install (Old Architecture)..."
    cd "$PROJECT_DIR/macos"
    pod install
    cd "$PROJECT_DIR"
fi

# Build the app
echo "Building macOS app ($CONFIGURATION)..."
cd "$PROJECT_DIR"
xcodebuild \
    -workspace macos/clauderon-mobile.xcworkspace \
    -scheme clauderon-mobile-macOS \
    -configuration "$CONFIGURATION" \
    build

echo "macOS build completed successfully!"

# Run the app if requested
if [ "$RUN_APP" = true ]; then
    echo "Launching macOS app..."
    APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -name "clauderon-mobile.app" -path "*${CONFIGURATION}*" 2>/dev/null | head -1)
    if [ -n "$APP_PATH" ]; then
        open "$APP_PATH"
    else
        echo "Warning: Could not find built app to launch"
    fi
fi
