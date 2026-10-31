#!/usr/bin/env bash
set -euo pipefail
android_test_root=$(mktemp -d)
trap 'rm -rf "$android_test_root"' EXIT
android_test_script=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/android-sdk.sh
mkdir -p "$android_test_root/bin" "$android_test_root/sdk/cmdline-tools/15859902/bin"
cat >"$android_test_root/bin/uname" <<'SH'
#!/usr/bin/env bash
case "$1" in -s) echo Linux ;; -m) echo "$ANDROID_TEST_ARCH" ;; *) exit 1 ;; esac
SH
cat >"$android_test_root/sdk/cmdline-tools/15859902/bin/sdkmanager" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >>"$ANDROID_TEST_LOG"
case "$*" in *--licenses*) cat >/dev/null ;; esac
SH
chmod +x "$android_test_root/bin/uname" "$android_test_root/sdk/cmdline-tools/15859902/bin/sdkmanager"
python3 - "$android_test_root/sdk" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
for path, identity in {
    "platforms/android-37.0": "platforms;android-37.0",
    "build-tools/37.0.0": "build-tools;37.0.0",
    "ndk/28.2.13676358": "ndk;28.2.13676358",
    "cmake/3.31.6": "cmake;3.31.6",
}.items():
    directory = root / path
    directory.mkdir(parents=True)
    (directory / "package.xml").write_text(f'<repository><localPackage path="{identity}"><revision><major>2</major></revision></localPackage></repository>')
clang = root / "ndk/28.2.13676358/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android29-clang"
clang.parent.mkdir(parents=True)
clang.touch()
PY
ANDROID_HOME="$android_test_root/sdk" ANDROID_TEST_ARCH=x86_64 ANDROID_TEST_LOG="$android_test_root/log" PATH="$android_test_root/bin:$PATH" bash "$android_test_script"
for android_test_package in 'platform-tools' 'platforms;android-37.0' 'build-tools;37.0.0' 'ndk;28.2.13676358' 'cmake;3.31.6'; do
  rg -Fxq "$android_test_package" "$android_test_root/log"
done
if ANDROID_HOME="$android_test_root/sdk" ANDROID_TEST_ARCH=aarch64 ANDROID_TEST_LOG="$android_test_root/log" PATH="$android_test_root/bin:$PATH" bash "$android_test_script" >"$android_test_root/arm64.log" 2>&1; then
  echo "Android native provisioning must reject unsupported Linux ARM64 hosts" >&2
  exit 1
fi
rg -Fq 'requires Linux x86_64' "$android_test_root/arm64.log"
printf '%s\n' '<repository><localPackage path="platforms;android-37.0"><revision><major>3</major></revision></localPackage></repository>' >"$android_test_root/sdk/platforms/android-37.0/package.xml"
if ANDROID_HOME="$android_test_root/sdk" ANDROID_TEST_ARCH=x86_64 ANDROID_TEST_LOG="$android_test_root/log" PATH="$android_test_root/bin:$PATH" bash "$android_test_script" >"$android_test_root/revision.log" 2>&1; then
  echo "Android provisioning must reject an unreviewed platform revision" >&2
  exit 1
fi
rg -Fq 'must have verified revision 2' "$android_test_root/revision.log"
echo "Android SDK bootstrap boundary tests passed"
