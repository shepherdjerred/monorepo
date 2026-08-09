#!/usr/bin/env bash
#
# The three invariants SwiftLint and the Swift compiler cannot enforce alone.
# Modelled on `packages/tasknotes-core/ci/no-suppressions.sh`, which does the
# same job for the Rust side.
#
#   1. No `swiftlint:disable` and no `swift-format-ignore`, anywhere.
#      `.swiftlint.yml` has a `banned_disable_comment` custom rule for the
#      first — but a `// swiftlint:disable all` disables that rule too, so
#      SwiftLint fundamentally cannot close this hole from inside. A plain grep
#      can. Neither mechanism is redundant; either alone has a gap.
#
#   2. `TaskNotesKit` imports no UI framework. The plan's testing strategy puts
#      Swift unit and snapshot coverage in a headless target, so a stray
#      `import SwiftUI` here does not break the build — it silently moves that
#      coverage behind a Mac-GUI-only gate, months before anyone notices.
#
#   3. Every authored target in `Package.swift` carries `authoredSwiftSettings`.
#      This is the exact analogue of the Rust script's `[lints] workspace =
#      true` check: a target added without it opts out of strict memory safety,
#      warnings-as-errors, and every upcoming feature at once, with no
#      diagnostic anywhere. `TaskNotesUniFFI` is the one documented exemption,
#      and it is named here rather than inferred so that adding a second exempt
#      target has to be a deliberate edit to this file.
#
# Runs on Linux: it is grep and awk, with no Swift toolchain involved.

set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
package_root="$(dirname -- "${script_directory}")"
cd "${package_root}"

# The single target exempt from the authored lint posture, because it re-exports
# machine-generated bindings. See the long comment in Package.swift.
exempt_target="TaskNotesUniFFI"

status=0

# ── 1. No suppression comments ──────────────────────────────────────────────
# grep exits 1 for "no matches" and >1 for a real error, so the two are
# distinguished explicitly rather than collapsed by a blanket fallback.
set +e
suppressions="$(
  grep -rn --include='*.swift' \
    --exclude-dir=.build \
    --exclude-dir=.swiftpm \
    -e 'swiftlint:disable' \
    -e 'swift-format-ignore' \
    -- .
)"
grep_status=$?
set -e

if [[ "${grep_status}" -gt 1 ]]; then
  echo "no-suppressions: grep failed with status ${grep_status}" >&2
  exit 1
fi

if [[ -n "${suppressions}" ]]; then
  echo "no-suppressions: lint suppression comments are banned." >&2
  echo "  Fix the violation, or change the rule in .swiftlint.yml /" >&2
  echo "  .swift-format, where the decision is visible and reviewable." >&2
  echo "${suppressions}" >&2
  status=1
fi

# ── 2. TaskNotesKit stays free of UI frameworks ─────────────────────────────
set +e
ui_imports="$(
  grep -rn --include='*.swift' \
    -E '^[[:space:]]*(public |internal |package |private |fileprivate )?import[[:space:]]+(SwiftUI|AppKit|Cocoa|UIKit)\b' \
    -- Sources/TaskNotesKit
)"
grep_status=$?
set -e

if [[ "${grep_status}" -gt 1 ]]; then
  echo "no-suppressions: grep failed with status ${grep_status}" >&2
  exit 1
fi

if [[ -n "${ui_imports}" ]]; then
  echo "no-suppressions: TaskNotesKit must not import a UI framework." >&2
  echo "  This target has to compile and test without a GUI; everything that" >&2
  echo "  needs SwiftUI or AppKit belongs in Sources/TaskNotesMac." >&2
  echo "${ui_imports}" >&2
  status=1
fi

# ── 3. Every authored target carries the full lint posture ──────────────────
if ! awk -v exempt="${exempt_target}" '
  function close_target() {
    if (in_target && target != exempt && !posture) {
      printf "  %s\n", (target == "" ? "<unnamed target>" : target)
      missing = 1
    }
  }
  # Comments discuss these settings by name — including the ban on unsafeFlags
  # — so they are skipped before any rule runs.
  /^[[:space:]]*\/\// { next }
  /\.target\(|\.testTarget\(|\.executableTarget\(/ {
    close_target()
    in_target = 1
    target = ""
    posture = 0
    next
  }
  in_target && target == "" && match($0, /name:[[:space:]]*"[^"]+"/) {
    found = substr($0, RSTART, RLENGTH)
    sub(/name:[[:space:]]*"/, "", found)
    sub(/"$/, "", found)
    target = found
  }
  in_target && /authoredSwiftSettings/ { posture = 1 }
  /unsafeFlags/ { print "  unsafeFlags is banned (line " NR ")"; missing = 1 }
  END {
    close_target()
    exit(missing ? 1 : 0)
  }
' Package.swift; then
  echo "no-suppressions: the targets above are missing authoredSwiftSettings." >&2
  echo "" >&2
  echo "  swiftSettings: authoredSwiftSettings + [.defaultIsolation(...)]" >&2
  echo "" >&2
  echo "  Without it the target silently opts out of strict memory safety," >&2
  echo "  warnings-as-errors, and every upcoming feature. ${exempt_target} is" >&2
  echo "  the one exemption, because it re-exports generated bindings." >&2
  status=1
fi

if [[ "${status}" -eq 0 ]]; then
  echo "no-suppressions: clean"
fi

exit "${status}"
