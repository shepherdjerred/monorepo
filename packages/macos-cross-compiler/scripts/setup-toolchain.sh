#!/usr/bin/env bash
# Wire the staged Apple SDKs into the Linux toolchain. Runs once, in the image
# build, after the SDK material is copied to /opt/apple.
#
# Four pieces, each the Xcode-native mechanism for its consumer:
#
#   1. /opt/apple/Developer — an Xcode-shaped developer directory. Swift Build
#      (SwiftPM's build engine, and Xcode's) registers Apple platforms and
#      their SDKs from it, reading each SDK's own SDKSettings: Mach-O image
#      format, platform IDs, the Mac Catalyst version map, SDK identity.
#   2. /ToolchainInfo.plist — build settings for the toolchain SwiftPM hands to
#      Swift Build, scoped to Apple SDKs: the Darwin Swift resource directory,
#      the SwiftUI macro plugin, and Apple's ld64.
#   3. /usr/bin/<triple>.cfg — clang configuration per Apple target triple:
#      the SDK (`-isysroot`, from which clang also records the SDK version in
#      LC_BUILD_VERSION), ld64, and Mac Catalyst's iOSSupport search paths.
#      Every clang invocation for that triple reads it — direct use, cc-rs,
#      Swift Build, and the links swiftc drives.
#   4. The Swift resource directory's `clang` and `host` links.
set -euo pipefail

apple=/opt/apple
sdks=$apple/sdks
resource=$apple/swift-resource
clang_resource=$(clang -print-resource-dir)
plugin="$apple/plugins/AppleMacros#SwiftUIMacros,PreviewsMacros"

# ── Swift resource directory. It must not be the toolchain's /usr/lib/swift:
# that one holds the Linux CoreFoundation, Dispatch, Block, and SwiftShims
# module maps, which shadow the SDK's. SwiftShims comes from the SDK itself.
ln -s "$clang_resource" "$resource/clang"
# Macro plugins (Observation, Testing, Foundation) are host executables.
ln -s /usr/lib/swift/host "$resource/host"
# The Darwin clang builtins (`___isPlatformVersionAtLeast`, …) every link needs.
mkdir -p "$clang_resource/lib/darwin"
cp "$apple"/clang-darwin/*.a "$clang_resource/lib/darwin/"

# ── 1. Developer directory, with Xcode's version record beside it as in
# Xcode.app/Contents (Swift Build reads <developer dir>/../version.plist).
# Each platform's testing libraries (XCTest, Swift Testing) live in its
# Developer/Library/Frameworks and Developer/usr/lib, as in Xcode.
for platform in MacOSX iPhoneOS; do
  dir=$apple/Developer/Platforms/$platform.platform
  mkdir -p "$dir/Developer/SDKs"
  cp "$apple/platforms/$platform.platform/Info.plist" "$apple/platforms/$platform.platform/version.plist" "$dir/"
  cp -R "$apple/platforms/$platform.platform/Developer/Library" "$apple/platforms/$platform.platform/Developer/usr" "$dir/Developer/"
  ln -s "$sdks/$platform.sdk" "$dir/Developer/SDKs/$platform.sdk"
done

# ── 2. Toolchain build settings.
settings=""
for sdk in 'macosx*' 'iphoneos*'; do
  settings+="    <key>SWIFT_RESOURCE_DIR[sdk=$sdk]</key><string>$resource</string>
    <key>ALTERNATE_LINKER[sdk=$sdk]</key><string>/usr/local/bin/ld64</string>
    <key>OTHER_SWIFT_FLAGS[sdk=$sdk]</key><string>\$(inherited) -load-plugin-executable $plugin</string>
"
done
cat > /ToolchainInfo.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Identifier</key><string>org.swift.macos-cross-compiler</string>
  <key>DefaultBuildSettings</key>
  <dict>
$settings  </dict>
</dict>
</plist>
PLIST

# ── 3. clang configuration per target triple (unversioned: clang matches the
# triple without its OS version). Both spellings of macOS are in use:
# swiftc says `macosx`, `--target=arm64-apple-macos15` says `macos`.
support=$sdks/MacOSX.sdk/System/iOSSupport
for arch in arm64 x86_64; do
  for os in macos macosx; do
    printf -- '-isysroot %s\n--ld-path=/usr/local/bin/ld64\n' "$sdks/MacOSX.sdk" > "/usr/bin/$arch-apple-$os.cfg"
  done
  printf -- '-isysroot %s\n--ld-path=/usr/local/bin/ld64\n-iframework %s\n-isystem %s\n-L%s\n' \
    "$sdks/MacOSX.sdk" "$support/System/Library/Frameworks" "$support/usr/include" "$support/usr/lib" \
    > "/usr/bin/$arch-apple-ios-macabi.cfg"
done
printf -- '-isysroot %s\n--ld-path=/usr/local/bin/ld64\n' "$sdks/iPhoneOS.sdk" > /usr/bin/arm64-apple-ios.cfg
