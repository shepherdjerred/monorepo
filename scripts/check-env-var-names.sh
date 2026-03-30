#!/usr/bin/env bash
set -eu

# Banned env var patterns → canonical replacement
# Uses case-insensitive substring matching to catch reintroduction of old names.
# Format: PATTERN:CANONICAL_NAME
#
# See: packages/docs/decisions/2026-03-27_env-var-naming-convention.md
BANNED=(
  "GRAFANA_SERVER:GRAFANA_URL"
  "GRAFANA_TOKEN:GRAFANA_API_KEY"
  "PAGERDUTY_API_KEY:PAGERDUTY_TOKEN"
  "PAGERDUTY_API_TOKEN:PAGERDUTY_TOKEN"
  "RIOT_API_TOKEN:RIOT_API_KEY"
  "BUGSINK_API_TOKEN:BUGSINK_TOKEN"
  "CF_ACCOUNT_ID:CLOUDFLARE_ACCOUNT_ID"
  "CF_R2_ACCESS:CLOUDFLARE_R2_ACCESS_KEY_ID"
  "CF_R2_SECRET:CLOUDFLARE_R2_SECRET_ACCESS_KEY"
  "TS_AUTH_KEY:TS_AUTHKEY"
)

# These need special handling due to substring overlap with valid names
# GITHUB_TOKEN: valid in TOFU_GITHUB_TOKEN, comments explaining migration, MCP server requirements
# ARGOCD_TOKEN: valid in ARGOCD_AUTH_TOKEN, Python variable argocd_token

ERRORS=0

for entry in "${BANNED[@]}"; do
  PATTERN="${entry%%:*}"
  CANONICAL="${entry##*:}"

  # Case-insensitive substring match across staged files
  MATCHES=$(grep -ni "${PATTERN}" "$@" \
    | grep -v 'archive/' \
    | grep -v 'generated/imports/' \
    | grep -v 'check-env-var-names.sh' \
    | grep -v 'env-var-naming-convention.md' \
    | grep -v 'packages/clauderon/' \
    || true)

  if [ -n "$MATCHES" ]; then
    echo "FAIL: Found banned pattern '${PATTERN}' (use '${CANONICAL}' instead):"
    echo "$MATCHES"
    echo ""
    ERRORS=$((ERRORS+1))
  fi
done

# GITHUB_TOKEN check: match the exact env var name, not substrings like TOFU_GITHUB_TOKEN
# or Python variable names, or MCP server requirements
GITHUB_MATCHES=$(grep -n 'GITHUB_TOKEN' "$@" \
  | grep -v 'archive/' \
  | grep -v 'generated/imports/' \
  | grep -v 'check-env-var-names.sh' \
  | grep -v 'env-var-naming-convention.md' \
  | grep -v 'packages/clauderon/' \
  | grep -v 'TOFU_GITHUB_TOKEN' \
  | grep -v 'GLANCE_TEST_' \
  | grep -v '@modelcontextprotocol' \
  | grep -v 'server-github expects' \
  | grep -v 'mcp-gateway' \
  | grep -v 'YOUR_GITHUB_TOKEN' \
  | grep -v 'env:GITHUB_TOKEN' \
  || true)

if [ -n "$GITHUB_MATCHES" ]; then
  echo "FAIL: Found banned pattern 'GITHUB_TOKEN' (use 'GH_TOKEN' instead):"
  echo "$GITHUB_MATCHES"
  echo ""
  ERRORS=$((ERRORS+1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS banned env var pattern(s). See above for details."
  exit 1
fi
