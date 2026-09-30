#!/usr/bin/env bash
#
# Cross-compile the TaskNotes Apple static libraries on Linux.
#
# Run inside ghcr.io/shepherdjerred/macos-cross-compiler:15.0
# (sha256:fb61376ae4288abb57ea477ae55e8b9df280c46bb622d9bb50c4755b6ebbf44f):
#
#   docker run --platform linux/amd64 --rm \
#     -v "$PWD":/src -w /src \
#     ghcr.io/shepherdjerred/macos-cross-compiler:15.0@sha256:fb61376ae4288abb57ea477ae55e8b9df280c46bb622d9bb50c4755b6ebbf44f \
#     packages/tasknotes-core/ci/apple-cross.sh
#
# The Rust version comes from the repo's .mise.toml. Deployment targets match
# xtask's Apple slices: macOS 15.0, iOS 18.0. The dev profile is the compile
# gate; the Mac lane still builds the reldbg XCFramework with xcodebuild.

set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/../../.." && pwd)"
workspace_root="${repository_root}/packages/tasknotes-core"

if [[ ! -x /osxcross/bin/aarch64-apple-darwin24-clang ]] ||
  [[ ! -x /cctools/bin/aarch64-apple-darwin24-lipo ]] ||
  [[ ! -x /cctools/bin/aarch64-apple-darwin24-vtool ]] ||
  ! command -v zig >/dev/null 2>&1 ||
  ! command -v rustup >/dev/null 2>&1; then
  echo "apple-cross.sh must run inside ghcr.io/shepherdjerred/macos-cross-compiler:15.0@sha256:fb61376ae4288abb57ea477ae55e8b9df280c46bb622d9bb50c4755b6ebbf44f" >&2
  exit 1
fi

rust_version="$(
  awk -F'"' '$1 ~ /^rust = / { print $2; exit }' "${repository_root}/.mise.toml"
)"
if [[ -z "${rust_version}" ]]; then
  echo "could not read the rust pin from ${repository_root}/.mise.toml" >&2
  exit 1
fi

export PATH="/root/.cargo/bin:${PATH}"
# Same numbers as Platform::deployment_environment in xtask/src/swift.rs.
export MACOSX_DEPLOYMENT_TARGET="15.0"
export IPHONEOS_DEPLOYMENT_TARGET="18.0"
export RUSTC_WRAPPER="${script_directory}/apple-staticlib-rustc.sh"

if ! rustc "+${rust_version}" --version |
  grep -F -q " ${rust_version} "; then
  rustup toolchain install "${rust_version}" --profile minimal --no-self-update
fi
rustup target add --toolchain "${rust_version}" \
  aarch64-apple-darwin \
  x86_64-apple-darwin \
  aarch64-apple-ios \
  aarch64-apple-ios-sim \
  x86_64-apple-ios

require_archive() {
  local archive="${1}"
  local expected_platform="${2}"
  local expected_minos="${3}"
  local expected_arch="${4}"
  local object_directory object show platform minos info

  object_directory="$(mktemp -d)"
  (
    cd -- "${object_directory}"
    aarch64-apple-darwin24-ar -x "${archive}" >/dev/null
  )
  object="$(find "${object_directory}" -name '*.o' -print -quit)"
  if [[ -z "${object}" ]]; then
    echo "no Mach-O object in ${archive}" >&2
    rm -rf -- "${object_directory}"
    exit 1
  fi
  show="$(aarch64-apple-darwin24-vtool -show-build "${object}")"
  rm -rf -- "${object_directory}"
  platform="$(awk '/^[[:space:]]*platform / { print $2; exit }' <<<"${show}")"
  minos="$(awk '/^[[:space:]]*minos / { print $2; exit }' <<<"${show}")"
  info="$(aarch64-apple-darwin24-lipo -info "${archive}")"
  if [[ "${platform}" != "${expected_platform}" || "${minos}" != "${expected_minos}" ]]; then
    echo "${archive} is ${platform} ${minos}, expected ${expected_platform} ${expected_minos}" >&2
    echo "${show}" >&2
    exit 1
  fi
  if [[ "${info}" != *"architecture: ${expected_arch}" ]]; then
    echo "${archive} is not ${expected_arch}: ${info}" >&2
    exit 1
  fi
  echo "${archive}: ${platform} ${minos} ${expected_arch}"
}

cd -- "${workspace_root}"
while read -r target platform minos arch; do
  [[ -z "${target}" || "${target}" == \#* ]] && continue
  echo "===== ${target} ====="
  cargo "+${rust_version}" build --locked --package tasknotes-core-ffi --lib \
    --target "${target}"
  require_archive \
    "${CARGO_TARGET_DIR:-target}/${target}/debug/libtasknotes_core_ffi.a" \
    "${platform}" "${minos}" "${arch}"
done <<'EOF'
aarch64-apple-darwin MACOS 15.0 arm64
x86_64-apple-darwin MACOS 15.0 x86_64
aarch64-apple-ios IOS 18.0 arm64
aarch64-apple-ios-sim IOSSIMULATOR 18.0 arm64
x86_64-apple-ios IOSSIMULATOR 18.0 x86_64
EOF

slice_directory="${CARGO_TARGET_DIR:-target}/apple-cross"
mkdir -p \
  "${slice_directory}/macos" \
  "${slice_directory}/ios" \
  "${slice_directory}/ios-sim"
target_root="${CARGO_TARGET_DIR:-target}"
aarch64-apple-darwin24-lipo -create \
  "${target_root}/aarch64-apple-darwin/debug/libtasknotes_core_ffi.a" \
  "${target_root}/x86_64-apple-darwin/debug/libtasknotes_core_ffi.a" \
  -output "${slice_directory}/macos/libtasknotes_core_ffi.a"
cp -- \
  "${target_root}/aarch64-apple-ios/debug/libtasknotes_core_ffi.a" \
  "${slice_directory}/ios/libtasknotes_core_ffi.a"
aarch64-apple-darwin24-lipo -create \
  "${target_root}/aarch64-apple-ios-sim/debug/libtasknotes_core_ffi.a" \
  "${target_root}/x86_64-apple-ios/debug/libtasknotes_core_ffi.a" \
  -output "${slice_directory}/ios-sim/libtasknotes_core_ffi.a"

macos_info="$(aarch64-apple-darwin24-lipo -info "${slice_directory}/macos/libtasknotes_core_ffi.a")"
simulator_info="$(aarch64-apple-darwin24-lipo -info "${slice_directory}/ios-sim/libtasknotes_core_ffi.a")"
for info in "${macos_info}" "${simulator_info}"; do
  if [[ "${info}" != *arm64* || "${info}" != *x86_64* ]]; then
    echo "universal slice is missing an architecture: ${info}" >&2
    exit 1
  fi
done
echo "${macos_info}"
echo "${simulator_info}"
echo "apple-cross: static libraries are in ${slice_directory}"
