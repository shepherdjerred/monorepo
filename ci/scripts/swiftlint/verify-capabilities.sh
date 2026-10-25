#!/usr/bin/env bash
# Exercise the configured linter, including checks static builds cannot run.
set -euo pipefail

swiftlint_binary=${1:?SwiftLint executable is required}
swiftlint_config=${2:?SwiftLint configuration is required}
swiftlint_expected_version=${3:?Expected SwiftLint version is required}
swiftlint_probe=$(mktemp -d)
trap 'rm -rf "$swiftlint_probe"' EXIT

"$swiftlint_binary" version >"$swiftlint_probe/version"
if [[ $(<"$swiftlint_probe/version") != "$swiftlint_expected_version" ]]; then
  echo "SwiftLint does not match the configured version $swiftlint_expected_version" >&2
  exit 1
fi

cat >"$swiftlint_probe/positive.swift" <<'SWIFT'
func configuredLintCanary(_ enabled: Bool) -> Int {
    if enabled {
        return 1
    } else {
        return 2
    }
}
SWIFT
cat >"$swiftlint_probe/negative.swift" <<'SWIFT'
enum CanaryChoice {
    case first
    case second
}
func switchCanary(_ choice: CanaryChoice) -> Int {
    switch choice {
    default: return 1
    }
}
func shadowCanary(_ value: Int) {
    do {
        let value = 1
        print(value)
    }
    _ = value
}
func errorCanary() throws {
    _ = try? errorCanary()
    _ = unsafeBitCast(0, to: Int.self)
}
func positionCanary(_ enabled: Bool) -> Int {
    if enabled {
        return 1
    }
    else {
        return 2
    }
}
SWIFT
# This is generated negative test input, never a source suppression.
printf '// swiftlint%s unused_import\n' ':disable' >>"$swiftlint_probe/negative.swift"

lint_canary() {
  local fixture=$1 config=$2 expected_status=$3 name=$4 required_rules=$5 status
  if "$swiftlint_binary" lint --strict --quiet --no-cache --use-stdin \
    --config "$config" --reporter json <"$fixture" \
    >"$swiftlint_probe/$name.json" 2>"$swiftlint_probe/$name.stderr"; then
    status=0
  else
    status=$?
  fi
  printf '%s\n' "$status" >"$swiftlint_probe/$name.status"
  if [[ "$status" != "$expected_status" ]]; then
    echo "SwiftLint $name canary exited $status; expected $expected_status" >&2
    cat "$swiftlint_probe/$name.stderr" >&2
    return 1
  fi
  python3 - "$swiftlint_probe/$name.json" "$swiftlint_probe/$name.stderr" "$required_rules" <<'PY'
import json
import pathlib
import sys

output, diagnostics = (pathlib.Path(value).read_text(encoding="utf-8") for value in sys.argv[1:3])
if diagnostics.strip():
    raise SystemExit(f"SwiftLint emitted unexpected diagnostics: {diagnostics}")
result = json.loads(output)
if not isinstance(result, list) or any(not isinstance(item, dict) or not isinstance(item.get("rule_id"), str) for item in result):
    raise SystemExit("SwiftLint returned an invalid violation report")
actual = {item["rule_id"] for item in result}
required = set(filter(None, sys.argv[3].split(",")))
if not required and result:
    raise SystemExit(f"SwiftLint rejected the valid canary: {sorted(actual)}")
if missing := required - actual:
    raise SystemExit(f"SwiftLint failed to enforce configured rules: {sorted(missing)}")
PY
}

lint_canary "$swiftlint_probe/positive.swift" "$swiftlint_config" 0 positive ''
lint_canary "$swiftlint_probe/negative.swift" "$swiftlint_config" 2 negative \
  'banned_switch_default,banned_print,banned_optional_try,banned_unsafe_escape,banned_disable_comment,variable_shadowing,statement_position'

printf 'opt_in_rules:\n  - facet_canary_must_not_exist\n' >"$swiftlint_probe/unknown.yml"
if lint_canary "$swiftlint_probe/positive.swift" "$swiftlint_probe/unknown.yml" 0 unknown '' \
  >"$swiftlint_probe/unknown-check.stdout" 2>"$swiftlint_probe/unknown-check.stderr"; then
  echo "SwiftLint capability verification accepted an unknown configured rule" >&2
  exit 1
fi
if ! grep -Fq 'facet_canary_must_not_exist' "$swiftlint_probe/unknown.stderr"; then
  echo "The unknown-rule control failed without its expected diagnostic" >&2
  exit 1
fi
if [[ $(<"$swiftlint_probe/unknown.status") != 0 ]]; then
  echo "The unknown-rule control did not complete normally" >&2
  exit 1
fi
echo "SwiftLint $swiftlint_expected_version: configured rules, SourceKit and unknown-rule rejection verified"
