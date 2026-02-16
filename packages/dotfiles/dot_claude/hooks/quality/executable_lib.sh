#!/usr/bin/env bash
# Shared utilities for quality enforcement hooks.
# Sourced by all other scripts — not executed directly.

# --- State management ---

init_state() {
  local session_id="$1"
  STATE_DIR="/tmp/claude-quality-${session_id}"
  mkdir -p "$STATE_DIR"
  export STATE_DIR
}

read_state() {
  local file="$1" default="${2:-}"
  if [[ -f "${STATE_DIR}/${file}" ]]; then
    cat "${STATE_DIR}/${file}"
  else
    printf '%s' "$default"
  fi
}

write_state() {
  local file="$1" value="$2"
  printf '%s' "$value" > "${STATE_DIR}/${file}"
}

increment_counter() {
  local file="$1"
  local current
  current="$(read_state "$file" "0")"
  local new_val=$(( current + 1 ))
  write_state "$file" "$new_val"
  printf '%d' "$new_val"
}

# --- Antipattern scanning ---

# Exception contexts — skip these files entirely.
should_skip_file() {
  local fp="$1"
  # Only scan TS/TSX files
  case "$fp" in
    *.ts|*.tsx) ;;
    *) return 0 ;;
  esac
  # Skip known exception contexts
  case "$fp" in
    *.d.ts)        return 0 ;;
    *setup*)       return 0 ;;
    *helper*)      return 0 ;;
    *mock*)        return 0 ;;
    *fixture*)     return 0 ;;
    *eslint*config*) return 0 ;;
  esac
  return 1
}

# Scan content for antipatterns.
# Outputs pipe-delimited lines: name|cost|severity
# severity is either "critical" (DENY in PreToolUse) or "warn"
scan_for_antipatterns() {
  local content="$1"
  local file_path="${2:-}"

  if [[ -n "$file_path" ]] && should_skip_file "$file_path"; then
    return 0
  fi

  local findings=""

  if printf '%s' "$content" | grep -q 'as any'; then
    findings="${findings}as any|3|critical\n"
  fi
  if printf '%s' "$content" | grep -qi 'eslint-disable'; then
    findings="${findings}eslint-disable|5|critical\n"
  fi
  if printf '%s' "$content" | grep -q '@ts-ignore'; then
    findings="${findings}@ts-ignore|5|critical\n"
  fi
  if printf '%s' "$content" | grep -q '@ts-expect-error'; then
    findings="${findings}@ts-expect-error|3|warn\n"
  fi
  if printf '%s' "$content" | grep -q '@ts-nocheck'; then
    findings="${findings}@ts-nocheck|10|critical\n"
  fi
  if printf '%s' "$content" | grep -qE 'catch.*\{[[:space:]]*\}'; then
    findings="${findings}empty catch|5|critical\n"
  fi
  if printf '%s' "$content" | grep -q '\.toBeTruthy()'; then
    findings="${findings}.toBeTruthy()|2|warn\n"
  fi
  if printf '%s' "$content" | grep -q '\.toBeFalsy()'; then
    findings="${findings}.toBeFalsy()|2|warn\n"
  fi
  if printf '%s' "$content" | grep -qE 'expect\((true|false)\)'; then
    findings="${findings}expect(true/false)|5|warn\n"
  fi
  if printf '%s' "$content" | grep -qE '(test|it|describe)\.skip'; then
    findings="${findings}test.skip|3|warn\n"
  fi

  if [[ -n "$findings" ]]; then
    printf '%b' "$findings"
  fi
}

# Helper: check if any findings are critical
has_critical() {
  local findings="$1"
  printf '%b' "$findings" | grep -q '|critical$'
}

# Helper: sum costs from findings
sum_costs() {
  local findings="$1"
  local total=0
  while IFS='|' read -r name cost severity; do
    [[ -z "$name" ]] && continue
    total=$(( total + cost ))
  done <<< "$(printf '%b' "$findings")"
  printf '%d' "$total"
}

# Helper: format findings as readable list
format_findings() {
  local findings="$1"
  while IFS='|' read -r name cost severity; do
    [[ -z "$name" ]] && continue
    printf '  - %s (-%d pts, %s)\n' "$name" "$cost" "$severity"
  done <<< "$(printf '%b' "$findings")"
}
