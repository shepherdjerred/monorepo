#!/usr/bin/env bash
#
# Put `Sparkle.framework` somewhere the test bundles' rpath can reach.
#
# Sparkle is the one dependency here that is a **dynamic framework** rather
# than a static archive, and SwiftPM's current build system does not link the
# two halves up for a test bundle. Measured rather than assumed:
#
#   * `swift build --show-bin-path` (`.build/out/Products/Debug`) is where
#     `Sparkle.framework` is placed.
#   * `otool -l` on `TaskNotesMacTests.xctest` lists these rpaths, and only
#     these: `/usr/lib/swift`, `@loader_path`, `<products>/PackageFrameworks`,
#     `@loader_path/Frameworks`, `@loader_path/../Frameworks`, and the
#     toolchain. The products directory itself is **not** among them.
#   * So `dlopen` of the test bundle fails with
#     `Library not loaded: @rpath/Sparkle.framework/Versions/B/Sparkle`, and the
#     whole `TaskNotesMacTests` target dies before a single test runs.
#
# `DYLD_FRAMEWORK_PATH` does not fix it: `swiftpm-testing-helper` lives inside
# Xcode and is signed with a restricted entitlement, so dyld strips every
# `DYLD_*` variable before it launches. Verified, not inferred.
#
# The legacy `--build-system native` path does not have the problem — it emits
# an `@loader_path/../../../` rpath that lands exactly on the directory holding
# the framework — but the package builds under the current default everywhere
# else, and running the tests under a second build system would double the
# build and split the diagnostics.
#
# So: one symlink, from a directory that *is* on the rpath to the framework
# that is already built. Idempotent, re-run before every test invocation, and
# it cannot go stale because it points at a path rather than a copy.
#
# ⚠️ This is a link-time path fix for **tests only**. The shipped `.app` does
# not go through here: `xcodebuild` embeds and signs `Sparkle.framework` into
# `Contents/Frameworks` itself, which is also what makes its XPC services and
# helper tools get re-signed for notarization.

set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
package_root="$(dirname -- "${script_directory}")"
cd "${package_root}"

products="$(swift build --show-bin-path)"
framework="${products}/Sparkle.framework"

if [[ ! -d "${framework}" ]]; then
  echo "stage-frameworks: ${framework} does not exist." >&2
  echo "  Build first — 'swift build --build-tests' is what puts it there." >&2
  exit 1
fi

mkdir -p -- "${products}/PackageFrameworks"
ln -sfn -- ../Sparkle.framework "${products}/PackageFrameworks/Sparkle.framework"
