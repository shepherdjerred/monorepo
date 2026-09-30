#!/usr/bin/env bash
# Stage the Apple material one image needs from an installed Xcode.
#
#   scripts/stage-xcode.sh [--developer-dir /Applications/Xcode-16.4.app/Contents/Developer]
#
# Runs on macOS. Writes .stage/<sdk>/ (gitignored), where <sdk> is the macOS
# SDK's major version (15, 26, 27, …), plus .stage/sdk-<sdk>.tar.zst and its
# sha256: the tarball is what CI builds the published image from.
#
# The stage holds the macOS and iOS SDKs, the Swift runtime pieces that live
# in Xcode's toolchain rather than the SDK, the clang builtins archives every
# Darwin link needs, the platform and Xcode version records Swift Build
# resolves, and each platform's testing libraries (XCTest, Swift Testing),
# which live beside the SDK rather than in it.
set -euo pipefail

developer=$(xcode-select -p)
while [ $# -gt 0 ]; do
  case "$1" in
    --developer-dir) developer=$2; shift 2 ;;
    *) echo "usage: $0 [--developer-dir <Xcode.app/Contents/Developer>]" >&2; exit 2 ;;
  esac
done
toolchain=$developer/Toolchains/XcodeDefault.xctoolchain
platforms=$developer/Platforms

sdk_version=$(plutil -extract Version raw "$platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/SDKSettings.plist")
sdk=${sdk_version%%.*}
root=$(cd "$(dirname "$0")/.." && pwd)/.stage
stage=$root/$sdk

rm -rf "$stage"
mkdir -p "$stage/sdks" "$stage/swift-resource" "$stage/clang-darwin" "$stage/platforms"

for platform in MacOSX iPhoneOS; do
  tar -C "$platforms/$platform.platform/Developer/SDKs" -cf - "$platform.sdk" | tar -C "$stage/sdks" -xf -
  mkdir -p "$stage/platforms/$platform.platform"
  cp "$platforms/$platform.platform/Info.plist" "$platforms/$platform.platform/version.plist" "$stage/platforms/$platform.platform/"
  # PrivateFrameworks: XCTest re-exports XCTestCore from there, so linking
  # against XCTest needs it.
  tar -C "$platforms/$platform.platform" -cf - Developer/Library/Frameworks Developer/Library/PrivateFrameworks Developer/usr/lib |
    tar -C "$stage/platforms/$platform.platform" -xf -
done

# Swift's per-platform static runtime pieces (compatibility shims, C++
# interop) and API notes. Prebuilt module caches and dylibs are built by
# Apple's compiler for macOS hosts and are useless to the Linux one.
for dir in apinotes macosx iphoneos maccatalyst; do
  if [ -d "$toolchain/usr/lib/swift/$dir" ]; then
    tar -C "$toolchain/usr/lib/swift" -cf - --exclude prebuilt-modules --exclude '*.dylib' "$dir" |
      tar -C "$stage/swift-resource" -xf -
  fi
done

cp "$toolchain"/usr/lib/clang/*/lib/darwin/libclang_rt.{osx,ios}.a "$stage/clang-darwin/"

# Xcode's own version record: Swift Build stamps DTXcode / DTXcodeBuild from it.
cp "$developer/../version.plist" "$stage/version.plist"

tarball=$root/sdk-$sdk.tar.zst
# Without these, macOS tar adds an AppleDouble `._<name>` entry for every file
# carrying an xattr (com.apple.provenance, on everything Xcode installs), and
# Linux extracts those as files: `._foo.h` beside each SDK header.
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs --no-fflags -C "$root" -cf - "$sdk" |
  zstd -q -19 -T0 -f -o "$tarball"
shasum -a 256 "$tarball" | cut -d' ' -f1 > "$tarball.sha256"
echo "staged Xcode $(plutil -extract CFBundleShortVersionString raw "$stage/version.plist") ($(plutil -extract ProductBuildVersion raw "$stage/version.plist")), macOS SDK $sdk_version, into $stage"
echo "tarball $tarball sha256 $(cat "$tarball.sha256")"
