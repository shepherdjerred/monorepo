#!/usr/bin/env bash
set -euo pipefail

# Shellcheck every tracked shell script. Exclusions mirror the old CI +
# lefthook config: frozen archives, vendored emscripten/C build tooling
# (mupen64plus scripts pre-date shebang conventions), CocoaPods, and Rust
# target dirs.

files=()
while IFS= read -r -d '' f; do
  case "$f" in
  */archive/* | *wasm-src/* | */Pods/* | */target/*) continue ;;
  esac
  files+=("$f")
done < <(git ls-files -z '*.sh')

if [ "${#files[@]}" -eq 0 ]; then
  echo "no shell scripts to check"
  exit 0
fi

shellcheck --severity=warning "${files[@]}"
