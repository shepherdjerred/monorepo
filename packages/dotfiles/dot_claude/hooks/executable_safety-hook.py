#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""Claude Code PreToolUse safety hook.

Reads safety-rules.json from the same directory and enforces:
- Hard deny for dangerous commands (regex-based)
- Warnings for sensitive command/file access (no block)

Ask-tier logic is handled by settings.json permission rules, not this hook.
"""

import json
import re
import sys
from pathlib import Path


def load_rules() -> dict:
    rules_path = Path(__file__).parent / "safety-rules.json"
    with open(rules_path) as f:
        return json.load(f)


def output_deny(reason: str) -> None:
    json.dump(
        {"hookSpecificOutput": {"permissionDecision": "deny", "additionalContext": f"BLOCKED: {reason}"}},
        sys.stdout,
    )
    sys.stdout.write("\n")


def output_warn(message: str) -> None:
    json.dump(
        {"hookSpecificOutput": {"additionalContext": f"WARNING: {message}"}},
        sys.stdout,
    )
    sys.stdout.write("\n")


def extract_inner_commands(command: str) -> list[str]:
    """Extract commands from bash -c '...' / sh -c '...' wrappers."""
    inner = []
    for m in re.finditer(r"""(?:ba)?sh\s+-c\s+(['"])(.*?)\1""", command):
        inner.append(m.group(2))
    return inner


def check_deny(command: str, rules: dict) -> str | None:
    """Check command against deny rules. Returns reason if denied, None otherwise."""
    for rule in rules["deny"]:
        regex = rule["regex"]
        if re.search(regex, command):
            # Special case: mass recursive deletion allows safe targets
            if rule["reason"] == "Mass recursive deletion":
                safe_targets = rules.get("safe_rm_targets", [])
                # Check if the rm target is a known safe directory
                # Match patterns like: rm -rf node_modules, rm -rf ./node_modules, rm -rf path/to/node_modules
                for target in safe_targets:
                    if re.search(rf"rm\s+(-rf|-fr|-r\s+-f|-f\s+-r)\s+(\S+/)?{re.escape(target)}\b", command):
                        return None  # Safe target, allow
                # If no safe target matched, deny
            return rule["reason"]
    return None


def check_bash(command: str, rules: dict) -> None:
    # Check deny rules against main command
    reason = check_deny(command, rules)
    if reason:
        output_deny(reason)
        return

    # Check inner commands from sh -c wrappers
    for inner in extract_inner_commands(command):
        reason = check_deny(inner, rules)
        if reason:
            output_deny(f"{reason} (inside shell wrapper)")
            return

    # Check warn_commands
    for warn in rules.get("warn_commands", []):
        if re.search(warn["regex"], command):
            output_warn(warn["message"])
            return


def check_file(file_path: str, rules: dict) -> None:
    for warn in rules.get("warn_files", []):
        if re.search(warn["pattern"], file_path):
            output_warn(warn["message"])
            return


def main() -> None:
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    rules = load_rules()

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        if command:
            check_bash(command, rules)
    elif tool_name == "WebFetch":
        output_deny("Use lightpanda CLI instead: lightpanda fetch --dump --strip_mode full --log_level fatal <url>")
    elif tool_name in ("Read", "Edit", "Write"):
        file_path = tool_input.get("file_path", "")
        if file_path:
            check_file(file_path, rules)


if __name__ == "__main__":
    main()
