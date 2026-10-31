#!/usr/bin/env bash
set -euo pipefail
swiftlint_test_root=$(mktemp -d)
trap 'rm -rf "$swiftlint_test_root"' EXIT
swiftlint_test_script=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verify-capabilities.sh
cat >"$swiftlint_test_root/swiftlint" <<'PY'
#!/usr/bin/env python3
import json
import pathlib
import sys

mode = pathlib.Path(__file__).with_name("mode").read_text(encoding="utf-8").strip()
if sys.argv[1] == "version":
    print("0.61.0" if mode == "wrong-version" else "0.65.1")
    raise SystemExit(0)
text = sys.stdin.read()
if "unknown.yml" in " ".join(sys.argv):
    if mode != "unknown-accepted":
        print("warning: 'facet_canary_must_not_exist' is not a valid rule identifier", file=sys.stderr)
    print("[]")
    raise SystemExit(139 if mode == "unknown-crash" else 0)
if mode == "unexpected-diagnostic":
    print("warning: skipping configured check", file=sys.stderr)
if "CanaryChoice" not in text:
    print("[]")
    raise SystemExit(0)
if mode == "tool-crash":
    raise SystemExit(139)
rules = ["banned_switch_default", "banned_print", "banned_optional_try", "banned_unsafe_escape", "banned_disable_comment", "variable_shadowing", "statement_position"]
if mode == "sourcekit-skipped":
    rules.remove("statement_position")
if mode == "custom-skipped":
    rules.remove("banned_switch_default")
print(json.dumps([{"rule_id": rule} for rule in rules]))
raise SystemExit(2)
PY
chmod +x "$swiftlint_test_root/swiftlint"
printf 'valid\n' >"$swiftlint_test_root/mode"
bash "$swiftlint_test_script" "$swiftlint_test_root/swiftlint" unused.yml 0.65.1
for swiftlint_test_mode in wrong-version unexpected-diagnostic tool-crash sourcekit-skipped custom-skipped unknown-accepted unknown-crash; do
  printf '%s\n' "$swiftlint_test_mode" >"$swiftlint_test_root/mode"
  if bash "$swiftlint_test_script" "$swiftlint_test_root/swiftlint" unused.yml 0.65.1 \
    >"$swiftlint_test_root/$swiftlint_test_mode.log" 2>&1; then
    echo "SwiftLint capability gate accepted $swiftlint_test_mode" >&2
    exit 1
  fi
done
echo "SwiftLint capability boundary controls passed: eight cases"
