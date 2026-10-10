#!/usr/bin/env bash
# Android's Linux NDK host tools are x86_64. Call only from that image/host.
set -euo pipefail

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo "Android SDK/NDK CI provisioning requires Linux x86_64; non-Android ARM64 lanes remain supported." >&2
  exit 1
fi

ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
ANDROID_CLI_BUILD=15859902
ANDROID_CLI_SHA256=4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583
ANDROID_SDK_MANAGER="$ANDROID_HOME/cmdline-tools/$ANDROID_CLI_BUILD/bin/sdkmanager"

if [[ ! -x "$ANDROID_SDK_MANAGER" ]]; then
  android_sdk_download=$(mktemp -d)
  trap 'rm -rf "$android_sdk_download"' EXIT
  curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CLI_BUILD}_latest.zip" -o "$android_sdk_download/cli.zip"
  printf '%s  %s\n' "$ANDROID_CLI_SHA256" "$android_sdk_download/cli.zip" | sha256sum -c -
  unzip -q "$android_sdk_download/cli.zip" -d "$android_sdk_download/unpacked"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  mv "$android_sdk_download/unpacked/cmdline-tools" "$ANDROID_HOME/cmdline-tools/$ANDROID_CLI_BUILD"
fi

# Feed a finite public acceptance input; unlike yes|sdkmanager this preserves
# pipefail and cannot turn the producer's SIGPIPE into an installation failure.
android_sdk_licenses=$(mktemp)
trap 'rm -f "$android_sdk_licenses"; if [[ -n "${android_sdk_download:-}" ]]; then rm -rf "$android_sdk_download"; fi' EXIT
printf 'y\n%.0s' {1..40} >"$android_sdk_licenses"
"$ANDROID_SDK_MANAGER" --sdk_root="$ANDROID_HOME" --licenses <"$android_sdk_licenses"
"$ANDROID_SDK_MANAGER" --sdk_root="$ANDROID_HOME" --install \
  'platform-tools' \
  'platforms;android-37.0' \
  'build-tools;37.0.0' \
  'ndk;28.2.13676358' \
  'cmake;3.31.6'

python3 - "$ANDROID_HOME" <<'PY'
import pathlib
import sys
import xml.etree.ElementTree as ET

root = pathlib.Path(sys.argv[1])
packages = {
    "platforms/android-37.0": "platforms;android-37.0",
    "build-tools/37.0.0": "build-tools;37.0.0",
    "ndk/28.2.13676358": "ndk;28.2.13676358",
    "cmake/3.31.6": "cmake;3.31.6",
}
for relative, expected in packages.items():
    manifest = ET.parse(root / relative / "package.xml")
    package = manifest.getroot().find("localPackage")
    if package is None or package.attrib.get("path") != expected:
        raise SystemExit(f"Android SDK inventory does not contain exact package {expected}")
    if relative == "platforms/android-37.0":
        revision = package.find("revision/major")
        if revision is None or revision.text != "2":
            raise SystemExit("Android platform 37.0 must have verified revision 2; review upstream changes before updating")
clang = root / "ndk/28.2.13676358/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android29-clang"
if not clang.is_file():
    raise SystemExit("The installed Android NDK lacks the supported Linux x86_64 host tools")
print("Android SDK inventory verified: platform 37.0 revision 2, build-tools 37.0.0, NDK 28.2.13676358, CMake 3.31.6")
PY
