#!/usr/bin/env bash
# Hermeticity lint guard for Bazel runner scripts.
# Fails if any runner script contains patterns that defeat Bazel's strict action env.
#
# Checked patterns:
#   - "export PATH=" — should use $TOOL_BIN env vars from $(location) instead
#   - "command -v" — should not search PATH for tools
#   - "mise" — should not depend on user's mise installation
#   - ".cargo/bin" — should use @multitool or @rules_rust
#   - "/opt/homebrew" — should not hardcode platform-specific paths
#   - "use_default_shell_env" — should not inherit full host environment
#
# Exempt a file by adding: # hermeticity-exempt: <reason>

set -euo pipefail

RUNFILES="${TEST_SRCDIR:-${BASH_SOURCE[0]}.runfiles}"
WS="${TEST_WORKSPACE:-_main}"
TOOLS_DIR="$RUNFILES/$WS/tools/bazel"

violations=0

check_pattern() {
  local pattern="$1"
  local description="$2"
  local file="$3"

  if grep -qn "$pattern" "$file" && ! grep -q "hermeticity-exempt:" "$file"; then
    echo "VIOLATION in $(basename "$file"): $description"
    grep -n "$pattern" "$file" | while IFS= read -r line; do
      echo "  $line"
    done
    violations=$((violations + 1))
  fi
}

echo "=== Hermeticity check: runner scripts ==="
for f in "$TOOLS_DIR"/*_runner.sh; do
  [ -f "$f" ] || continue
  # Check for hardcoded non-hermetic paths in PATH exports.
  # Allow: export PATH="$BUN_DIR:$PATH" (Bazel-provided variable)
  # Disallow: export PATH="/opt/homebrew/bin:..." or "~/.local/share/mise/..."
  if grep -qn "export PATH=.*\(/opt/homebrew\|/usr/local/bin\|\.local/share\|\.cargo/bin\|mise\)" "$f" \
     && ! grep -q "hermeticity-exempt:" "$f"; then
    echo "VIOLATION in $(basename "$f"): PATH with hardcoded non-hermetic paths"
    grep -n "export PATH=" "$f" | while IFS= read -r line; do
      echo "  $line"
    done
    violations=$((violations + 1))
  fi
  check_pattern "command -v" "PATH-based tool discovery is non-hermetic" "$f"
  check_pattern "mise" "mise dependency is non-hermetic" "$f"
  check_pattern '\.cargo/bin' ".cargo/bin dependency is non-hermetic" "$f"
  check_pattern "/opt/homebrew" "platform-specific path is non-hermetic" "$f"
done

echo "=== Hermeticity check: Starlark rules ==="
for f in "$TOOLS_DIR"/*.bzl; do
  [ -f "$f" ] || continue
  check_pattern "use_default_shell_env" "inherits full host environment" "$f"
done

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "FAILED: $violations hermeticity violation(s) found."
  echo "Fix by using hermetic binaries via \$(location @multitool//...) or \$(location @rules_...)."
  echo "If truly necessary, add '# hermeticity-exempt: <reason>' to the file."
  exit 1
fi

echo "PASSED: No hermeticity violations found."
