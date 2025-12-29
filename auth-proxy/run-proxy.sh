#!/usr/bin/env bash
#
# Run the auth-injecting proxy on the host.
#
# Usage:
#   ./run-proxy.sh
#
# Prerequisites:
#   pip install mitmproxy
#
# Environment variables (set these with your actual credentials):
#   GITHUB_TOKEN        - GitHub personal access token
#   ANTHROPIC_API_KEY   - Claude API key
#   PAGERDUTY_TOKEN     - PagerDuty API token
#   SENTRY_AUTH_TOKEN   - Sentry auth token
#   K8S_TOKEN           - Default Kubernetes bearer token
#   K8S_TOKEN_PROD      - Kubernetes token for 'prod' cluster
#   K8S_TOKEN_STAGING   - Kubernetes token for 'staging' cluster
#   TALOS_TOKEN         - Default Talos API token
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check for mitmproxy
if ! command -v mitmproxy &> /dev/null; then
    echo "mitmproxy not found. Install with: pip install mitmproxy"
    exit 1
fi

echo "Starting auth proxy on :8080..."
echo ""
echo "Configure your container with:"
echo "  HTTP_PROXY=http://host.docker.internal:8080"
echo "  HTTPS_PROXY=http://host.docker.internal:8080"
echo ""
echo "Loaded credentials for:"
[[ -n "${GITHUB_TOKEN:-}" ]] && echo "  ✓ GitHub"
[[ -n "${ANTHROPIC_API_KEY:-}" ]] && echo "  ✓ Anthropic/Claude"
[[ -n "${PAGERDUTY_TOKEN:-}" ]] && echo "  ✓ PagerDuty"
[[ -n "${SENTRY_AUTH_TOKEN:-}" ]] && echo "  ✓ Sentry"
[[ -n "${K8S_TOKEN:-}" ]] && echo "  ✓ Kubernetes (default)"
[[ -n "${TALOS_TOKEN:-}" ]] && echo "  ✓ Talos (default)"
echo ""

# Run mitmproxy with all addons
exec mitmproxy \
    --listen-host 0.0.0.0 \
    --listen-port 8080 \
    --mode regular \
    --set ssl_insecure=true \
    -s "${SCRIPT_DIR}/proxy.py" \
    -s "${SCRIPT_DIR}/k8s_proxy.py" \
    -s "${SCRIPT_DIR}/talos_proxy.py"
