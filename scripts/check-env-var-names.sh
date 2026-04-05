#!/usr/bin/env bash
set -eu

# Banned env var patterns → canonical replacement
# Uses case-insensitive substring matching to catch reintroduction of old names.
#
# See: packages/docs/decisions/2026-03-27_env-var-naming-convention.md

# --- File discovery (NUL-delimited to handle spaces in paths) ---
FILES_CMD=(git ls-files -z --
  '*.ts' '*.rs' '*.py' '*.fish' '*.tmpl' '*.yaml' '*.yml'
  '*.env' '*.md' '*.sh' '*.swift'
  ':!:archive/' ':!:practice/' ':!:.dagger/' ':!:.build/' ':!:**/generated/*'
)

# Files to exclude from all pattern matches
EXCLUDE_PATTERN='check-env-var-names\.sh|env-var-naming-convention\.md|packages/clauderon/|packages/docs/guides/2026-04-04_homelab-health-audit-2\.md|packages/docs/archive/'

# --- Bulk check: all simple banned patterns in one grep pass ---
BANNED_REGEX='GRAFANA_SERVER|GRAFANA_TOKEN|PAGERDUTY_API_KEY|PAGERDUTY_API_TOKEN|RIOT_API_TOKEN|BUGSINK_API_TOKEN|CF_ACCOUNT_ID|CF_R2_ACCESS|CF_R2_SECRET|TS_AUTH_KEY'

# Pattern → canonical name pairs (parallel arrays for bash 3 compat)
PATTERNS=(GRAFANA_SERVER GRAFANA_TOKEN PAGERDUTY_API_KEY PAGERDUTY_API_TOKEN RIOT_API_TOKEN BUGSINK_API_TOKEN CF_ACCOUNT_ID CF_R2_ACCESS CF_R2_SECRET TS_AUTH_KEY)
CANONICALS=(GRAFANA_URL GRAFANA_API_KEY PAGERDUTY_TOKEN PAGERDUTY_TOKEN RIOT_API_KEY BUGSINK_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_R2_ACCESS_KEY_ID CLOUDFLARE_R2_SECRET_ACCESS_KEY TS_AUTHKEY)

ERRORS=0

# Single grep pass for all simple banned patterns
MATCHES=$("${FILES_CMD[@]}" | xargs -0 grep -niE "${BANNED_REGEX}" | grep -vE "${EXCLUDE_PATTERN}" || true)

if [ -n "$MATCHES" ]; then
  while IFS= read -r line; do
    for i in "${!PATTERNS[@]}"; do
      if echo "$line" | grep -qi "${PATTERNS[$i]}"; then
        echo "FAIL: Found banned pattern '${PATTERNS[$i]}' (use '${CANONICALS[$i]}' instead):"
        echo "  $line"
        echo ""
        ERRORS=$((ERRORS+1))
        break
      fi
    done
  done <<< "$MATCHES"
fi

# --- Special case: GITHUB_TOKEN (exact env var name, not substrings like TOFU_GITHUB_TOKEN) ---
GITHUB_EXCLUDE='TOFU_GITHUB_TOKEN|GLANCE_TEST_|@modelcontextprotocol|server-github expects|mcp-gateway|YOUR_GITHUB_TOKEN|env:GITHUB_TOKEN|CHANGELOG\.md|plans/|dot_claude/skills/|GITHUB_TOKEN_URL|\.dagger/src/release\.ts'

GITHUB_MATCHES=$("${FILES_CMD[@]}" | xargs -0 grep -n 'GITHUB_TOKEN' | grep -vE "${EXCLUDE_PATTERN}" | grep -vE "${GITHUB_EXCLUDE}" || true)

if [ -n "$GITHUB_MATCHES" ]; then
  echo "FAIL: Found banned pattern 'GITHUB_TOKEN' (use 'GH_TOKEN' instead):"
  echo "$GITHUB_MATCHES"
  echo ""
  ERRORS=$((ERRORS+1))
fi

# --- Result ---
if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS banned env var pattern(s). See above for details."
  exit 1
fi
