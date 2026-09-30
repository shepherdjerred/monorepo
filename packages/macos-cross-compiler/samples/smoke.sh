#!/usr/bin/env bash
# Build every sample for every platform with this image's own tools, and check
# each Mach-O: architectures, LC_BUILD_VERSION platform, minimum OS, and that
# the recorded SDK is this image's SDK (not the deployment target).
#
#   /samples/smoke.sh [output dir]    (default /tmp/smoke)
set -euo pipefail
samples=$(cd "$(dirname "$0")" && pwd)
out=${1:-/tmp/smoke}
sdk_version=$(jq -r .Version "$MACOS_SDK/SDKSettings.json")
rm -rf "$out" && mkdir -p "$out"
cd "$out"

# expect <file> <platform: macos|ios|maccatalyst> <minos> <arch>...
expect() {
  local file=$1 platform=$2 minos=$3; shift 3
  local want_platform
  case "$platform" in macos) want_platform=1 ;; ios) want_platform=2 ;; maccatalyst) want_platform=6 ;; esac
  local archs; archs=$(lipo -archs "$file" | tr -s ' \n' '\n' | grep -v '^$' | sort | tr '\n' ' ')
  local want; want=$(printf '%s\n' "$@" | sort | tr '\n' ' ')
  [ "$archs" = "$want" ] || { echo "FAIL $file: architectures '$archs', want '$want'"; exit 1; }
  for arch in "$@"; do
    # llvm-otool ignores -arch; inspect each slice on its own.
    local slice=$file
    if [ $# -gt 1 ]; then slice=$(mktemp) && lipo "$file" -thin "$arch" -output "$slice"; fi
    local build; build=$(otool -l "$slice" | grep -A4 LC_BUILD_VERSION)
    local got_platform got_minos got_sdk
    got_platform=$(awk '/platform/ {print $2}' <<<"$build")
    got_minos=$(awk '/minos/ {print $2}' <<<"$build")
    got_sdk=$(awk '/ sdk/ {print $2}' <<<"$build")
    [ "$got_platform" = "$want_platform" ] && [ "$got_minos" = "$minos" ] && [ "$got_sdk" = "$sdk_version" ] || {
      echo "FAIL $file ($arch): platform $got_platform minos $got_minos sdk $got_sdk; want $want_platform $minos $sdk_version"
      exit 1
    }
  done
  echo "ok   $file: $platform $minos [$*] sdk $sdk_version"
}

# C, C++, Objective-C: every platform, via the triple-named clang wrappers.
for arch in arm64 x86_64; do
  "$arch-apple-macos-clang" "$samples/c/hello.c" -o "hello-c-$arch"
  "$arch-apple-macos-clang++" "$samples/cpp/hello.cpp" -o "hello-cpp-$arch"
  "$arch-apple-macos-clang" -fobjc-arc -framework Foundation "$samples/objc/hello.m" -o "hello-objc-$arch"
  "$arch-apple-ios-macabi-clang" "$samples/c/hello.c" -o "hello-c-maccatalyst-$arch"
done
for sample in c cpp objc; do
  lipo -create "hello-$sample-arm64" "hello-$sample-x86_64" -output "hello-$sample"
  expect "hello-$sample" macos 15.0 arm64 x86_64
done
lipo -create hello-c-maccatalyst-arm64 hello-c-maccatalyst-x86_64 -output hello-c-maccatalyst
expect hello-c-maccatalyst maccatalyst 18.0 arm64 x86_64
arm64-apple-ios-clang "$samples/c/hello.c" -o hello-c-ios
expect hello-c-ios ios 18.0 arm64
MACOSX_DEPLOYMENT_TARGET=26.0 arm64-apple-macos-clang "$samples/c/hello.c" -o hello-c-macos26
expect hello-c-macos26 macos 26.0 arm64

# Rust: cargo's Apple targets use the same clang and ld64.
cp -R "$samples/rust" rust && (
  cd rust
  for target in aarch64-apple-darwin x86_64-apple-darwin; do
    MACOSX_DEPLOYMENT_TARGET=15.0 cargo build --quiet --release --target "$target"
  done
  IPHONEOS_DEPLOYMENT_TARGET=18.0 cargo build --quiet --release --target aarch64-apple-ios
)
lipo -create rust/target/{aarch64,x86_64}-apple-darwin/release/hello -output hello-rust
expect hello-rust macos 15.0 arm64 x86_64
expect rust/target/aarch64-apple-ios/release/hello ios 18.0 arm64

# Swift: swiftc directly, and a SwiftPM package through Swift Build.
for arch in arm64 x86_64; do
  "$arch-apple-macos-swiftc" "$samples/swift-cli/Sources/Hello/main.swift" -o "hello-swiftc-$arch"
done
lipo -create hello-swiftc-arm64 hello-swiftc-x86_64 -output hello-swiftc
expect hello-swiftc macos 15.0 arm64 x86_64
cp -R "$samples/swift-cli" swift-cli && (
  cd swift-cli
  for arch in arm64 x86_64; do
    swift build --build-system swiftbuild --triple "$arch-apple-macosx15.0" --sdk "$MACOS_SDK" -c release --scratch-path ".build-$arch"
  done
)
lipo -create swift-cli/.build-{arm64,x86_64}/out/Products/Release/Hello -output hello-swiftpm
expect hello-swiftpm macos 15.0 arm64 x86_64

# SwiftUI and iOS apps: signed bundles, as Xcode builds them from project.yml.
applebuild "$samples/swiftui-app/project.yml" --target HelloSwiftUI --output apps --work work/swiftui
expect apps/HelloSwiftUI.app/Contents/MacOS/HelloSwiftUI macos 15.0 arm64 x86_64
# Ad-hoc signed (rcodesign's `verify` needs a CMS signature, which ad-hoc has
# none of): require the code directory to name the bundle and seal its
# Info.plist and resources.
signature=$(rcodesign print-signature-info apps/HelloSwiftUI.app/Contents/MacOS/HelloSwiftUI)
for want in "identifier: dev.macos-cross.HelloSwiftUI" "flags: CodeSignatureFlags(ADHOC)" "'Info (1): " "'Resources (3): "; do
  grep -qF -- "$want" <<<"$signature" || { echo "FAIL apps/HelloSwiftUI.app: signature lacks $want"; exit 1; }
done
echo "ok   apps/HelloSwiftUI.app: ad-hoc signature seals Info.plist and resources"

# Its unit tests: an .xctest bundle loaded by the app, embedded in its PlugIns.
applebuild "$samples/swiftui-app/project.yml" --target HelloTests --configuration Debug --output apps/tests --work work/tests
xctest=apps/tests/HelloSwiftUI.app/Contents/PlugIns/HelloTests.xctest/Contents/MacOS/HelloTests
expect "$xctest" macos 15.0 arm64
header=$(otool -hv "$xctest")
grep -qw BUNDLE <<<"$header" || { echo "FAIL $xctest: not an MH_BUNDLE"; exit 1; }
libraries=$(otool -L "$xctest")
for want in XCTest.framework/Versions/A/XCTest libXCTestSwiftSupport.dylib; do
  grep -qF "$want" <<<"$libraries" || { echo "FAIL $xctest: does not link $want"; exit 1; }
done
echo "ok   apps/tests/HelloSwiftUI.app: hosts HelloTests.xctest (XCTest and Swift Testing)"
applebuild "$samples/ios-app/project.yml" --target HelloiOS --platform ios --output apps/ios --work work/ios
expect apps/ios/HelloiOS.app/HelloiOS ios 18.0 arm64
applebuild "$samples/ios-app/project.yml" --target HelloiOS --platform maccatalyst --output apps/maccatalyst --work work/maccatalyst
expect apps/maccatalyst/HelloiOS.app/Contents/MacOS/HelloiOS maccatalyst 18.0 arm64 x86_64

# Swift, Objective-C, C, and C++ in one app target: the C++ pulls in libc++,
# every language's code is linked in, and headers stay out of the bundle.
applebuild "$samples/mixed-app/project.yml" --target MixedApp --output apps --work work/mixed
mixed=apps/MixedApp.app/Contents/MacOS/MixedApp
expect "$mixed" macos 15.0 arm64 x86_64
libraries=$(otool -L "$mixed")
grep -qF '/usr/lib/libc++.1.dylib' <<<"$libraries" || { echo "FAIL $mixed: does not link libc++"; exit 1; }
symbols=$(/usr/lib/llvm-apple/bin/llvm-nm "$mixed")
for want in "_OBJC_CLASS_\$_Greeter" _mixed_add _mixed_word_count "_OBJC_CLASS_\$__TtC8MixedApp5Tally"; do
  grep -qF -- "$want" <<<"$symbols" || { echo "FAIL $mixed: lacks $want"; exit 1; }
done
headers=$(find apps/MixedApp.app -name '*.h')
[ -z "$headers" ] || { echo "FAIL apps/MixedApp.app: headers copied into the bundle: $headers"; exit 1; }
echo "ok   apps/MixedApp.app: Swift, Objective-C, C, and C++ linked together"

echo "smoke: every sample built for every platform"
