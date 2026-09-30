#!/usr/bin/env bash
# Differential check, macOS only: expand every fixture with Xcode's own
# closed-source macro plugins and again with this package's, and require the
# expansions to be identical modulo whitespace. Also proves each expansion
# type-checks against the real SDK.
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release --product AppleMacros >/dev/null
plugin="$PWD/.build/release/AppleMacros#SwiftUIMacros,PreviewsMacros"
expand() {
  xcrun swiftc -target arm64-apple-macosx15.0 -typecheck "$@" -Xfrontend -dump-macro-expansions 2>&1 |
    python3 -c 'import re,sys
for b in re.split(r"\n-{30}\n", sys.stdin.read()):
    b = re.sub(r"\s+", " ", b).strip()
    if b: print(b)'
}
status=0
for fixture in Fixtures/*.swift; do
  if diff <(expand "$fixture") <(expand "$fixture" -load-plugin-executable "$plugin") >/dev/null; then
    echo "identical: $fixture ($(expand "$fixture" | grep -c .) expansions)"
  else
    echo "DIFFERENT: $fixture"; diff <(expand "$fixture") <(expand "$fixture" -load-plugin-executable "$plugin") | head -20; status=1
  fi
done
exit $status
