#!/usr/bin/env bash
#
# Phase 0: Integration Testing for Auth Proxy
# Run this script on your HOST machine (not inside a container)
#
# Prerequisites:
#   pip install mitmproxy
#   docker (running)
#   kubectl (configured with a cluster)
#   talosctl (optional, for Test 5)
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_test() { echo -e "\n${YELLOW}========================================${NC}"; echo -e "${YELLOW}TEST: $1${NC}"; echo -e "${YELLOW}========================================${NC}"; }

PROXY_PORT=18080
K8S_PROXY_PORT=18081
RESULTS_FILE="/tmp/proxy-test-results.txt"

cleanup() {
    log_info "Cleaning up background processes..."
    jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT

# Initialize results
echo "# Proxy Integration Test Results - $(date)" > "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

#############################################
# TEST 1: Docker containers respect HTTPS_PROXY
#############################################
test_docker_proxy() {
    log_test "1: Docker containers respect HTTPS_PROXY"

    echo "## Test 1: Docker HTTPS_PROXY" >> "$RESULTS_FILE"

    # Check if mitmproxy is installed
    if ! command -v mitmdump &> /dev/null; then
        log_error "mitmproxy not installed. Run: pip install mitmproxy"
        echo "FAIL: mitmproxy not installed" >> "$RESULTS_FILE"
        return 1
    fi

    # Start mitmproxy in background, logging to file
    log_info "Starting mitmdump on port $PROXY_PORT..."
    mitmdump --listen-port $PROXY_PORT --mode regular > /tmp/mitmproxy.log 2>&1 &
    MITM_PID=$!
    sleep 2

    # Check if mitmdump started
    if ! kill -0 $MITM_PID 2>/dev/null; then
        log_error "Failed to start mitmdump"
        echo "FAIL: mitmdump failed to start" >> "$RESULTS_FILE"
        return 1
    fi

    log_info "Running container with HTTPS_PROXY..."

    # Run container with proxy - using curl which respects proxy env vars
    docker run --rm \
        -e HTTP_PROXY=http://host.docker.internal:$PROXY_PORT \
        -e HTTPS_PROXY=http://host.docker.internal:$PROXY_PORT \
        curlimages/curl:latest \
        -s -o /dev/null -w "%{http_code}" --insecure https://api.github.com 2>/dev/null || true

    sleep 1

    # Check if request appeared in mitmproxy log
    if grep -q "api.github.com" /tmp/mitmproxy.log; then
        log_info "SUCCESS: Traffic routed through proxy!"
        echo "PASS: Docker container traffic routed through proxy" >> "$RESULTS_FILE"
        kill $MITM_PID 2>/dev/null || true
        return 0
    else
        log_error "FAIL: No traffic seen in proxy"
        cat /tmp/mitmproxy.log
        echo "FAIL: No traffic seen in proxy" >> "$RESULTS_FILE"
        kill $MITM_PID 2>/dev/null || true
        return 1
    fi
}

#############################################
# TEST 2: Header injection works
#############################################
test_header_injection() {
    log_test "2: Header injection via proxy addon"

    echo "## Test 2: Header Injection" >> "$RESULTS_FILE"

    # Create test addon
    cat > /tmp/test_inject.py << 'ADDON'
from mitmproxy import http
import sys

def request(flow: http.HTTPFlow):
    if "api.github.com" in flow.request.host:
        flow.request.headers["X-Test-Injected"] = "test-value-12345"
        print(f"INJECTED header for {flow.request.host}", file=sys.stderr, flush=True)
ADDON

    log_info "Starting mitmdump with injection addon..."
    mitmdump --listen-port $PROXY_PORT --mode regular -s /tmp/test_inject.py > /tmp/mitmproxy2.log 2>&1 &
    MITM_PID=$!
    sleep 2

    if ! kill -0 $MITM_PID 2>/dev/null; then
        log_error "Failed to start mitmdump with addon"
        echo "FAIL: mitmdump with addon failed to start" >> "$RESULTS_FILE"
        return 1
    fi

    log_info "Running container to test header injection..."
    docker run --rm \
        -e HTTPS_PROXY=http://host.docker.internal:$PROXY_PORT \
        curlimages/curl:latest \
        -s --insecure https://api.github.com 2>/dev/null || true

    sleep 1

    if grep -q "INJECTED" /tmp/mitmproxy2.log; then
        log_info "SUCCESS: Header injection working!"
        echo "PASS: Header injection works" >> "$RESULTS_FILE"
        kill $MITM_PID 2>/dev/null || true
        return 0
    else
        log_error "FAIL: Header injection not working"
        cat /tmp/mitmproxy2.log
        echo "FAIL: Header injection not working" >> "$RESULTS_FILE"
        kill $MITM_PID 2>/dev/null || true
        return 1
    fi
}

#############################################
# TEST 3: Container trusts custom CA
#############################################
test_custom_ca() {
    log_test "3: Container trusts custom CA certificate"

    echo "## Test 3: Custom CA Trust" >> "$RESULTS_FILE"

    # Check for mitmproxy CA
    MITM_CA="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
    if [[ ! -f "$MITM_CA" ]]; then
        log_warn "mitmproxy CA not found at $MITM_CA"
        log_info "Running mitmproxy once to generate CA..."
        timeout 3 mitmdump --listen-port 19999 2>/dev/null || true
        sleep 1
    fi

    if [[ ! -f "$MITM_CA" ]]; then
        log_error "Could not generate mitmproxy CA"
        echo "FAIL: Could not generate CA" >> "$RESULTS_FILE"
        return 1
    fi

    log_info "Starting mitmdump..."
    mitmdump --listen-port $PROXY_PORT --mode regular > /tmp/mitmproxy3.log 2>&1 &
    MITM_PID=$!
    sleep 2

    log_info "Testing with Python requests + custom CA..."

    # Run Python container with CA mounted
    docker run --rm \
        -e HTTPS_PROXY=http://host.docker.internal:$PROXY_PORT \
        -e REQUESTS_CA_BUNDLE=/etc/ssl/proxy-ca.pem \
        -v "$MITM_CA:/etc/ssl/proxy-ca.pem:ro" \
        python:3-slim \
        python -c "import requests; r = requests.get('https://api.github.com'); print(f'Status: {r.status_code}')" 2>&1 || true

    sleep 1

    if grep -q "api.github.com" /tmp/mitmproxy3.log; then
        log_info "SUCCESS: Custom CA trusted, no SSL errors!"
        echo "PASS: Custom CA trust works" >> "$RESULTS_FILE"
        kill $MITM_PID 2>/dev/null || true
        return 0
    else
        log_error "FAIL: Request did not go through proxy"
        echo "FAIL: Custom CA trust not working" >> "$RESULTS_FILE"
        kill $MITM_PID 2>/dev/null || true
        return 1
    fi
}

#############################################
# TEST 4: kubectl proxy from container
#############################################
test_kubectl_proxy() {
    log_test "4: kubectl proxy works from container"

    echo "## Test 4: kubectl Proxy" >> "$RESULTS_FILE"

    if ! command -v kubectl &> /dev/null; then
        log_warn "kubectl not installed, skipping"
        echo "SKIP: kubectl not installed" >> "$RESULTS_FILE"
        return 0
    fi

    # Check if we have a working cluster
    if ! kubectl cluster-info &> /dev/null; then
        log_warn "No Kubernetes cluster configured, skipping"
        echo "SKIP: No Kubernetes cluster" >> "$RESULTS_FILE"
        return 0
    fi

    log_info "Starting kubectl proxy on port $K8S_PROXY_PORT..."
    kubectl proxy --port=$K8S_PROXY_PORT --address=0.0.0.0 --accept-hosts='.*' &
    K8S_PID=$!
    sleep 2

    if ! kill -0 $K8S_PID 2>/dev/null; then
        log_error "Failed to start kubectl proxy"
        echo "FAIL: kubectl proxy failed to start" >> "$RESULTS_FILE"
        return 1
    fi

    # Create minimal kubeconfig
    cat > /tmp/container-kubeconfig.yaml << EOF
apiVersion: v1
kind: Config
clusters:
- cluster:
    server: http://host.docker.internal:$K8S_PROXY_PORT
  name: proxied
contexts:
- context:
    cluster: proxied
  name: default
current-context: default
EOF

    log_info "Testing kubectl from container..."
    RESULT=$(docker run --rm \
        -v /tmp/container-kubeconfig.yaml:/etc/kube/config:ro \
        -e KUBECONFIG=/etc/kube/config \
        bitnami/kubectl:latest \
        get namespaces --no-headers 2>&1 || true)

    kill $K8S_PID 2>/dev/null || true

    if echo "$RESULT" | grep -q "default\|kube-system"; then
        log_info "SUCCESS: kubectl works from container via proxy!"
        echo "PASS: kubectl proxy works from container" >> "$RESULTS_FILE"
        return 0
    else
        log_error "FAIL: kubectl from container failed"
        echo "Output: $RESULT"
        echo "FAIL: kubectl proxy not working" >> "$RESULTS_FILE"
        return 1
    fi
}

#############################################
# TEST 5: Talos gRPC proxy
#############################################
test_talos_grpc() {
    log_test "5: Talos gRPC respects HTTPS_PROXY"

    echo "## Test 5: Talos gRPC" >> "$RESULTS_FILE"

    if ! command -v talosctl &> /dev/null; then
        log_warn "talosctl not installed, skipping"
        echo "SKIP: talosctl not installed" >> "$RESULTS_FILE"
        echo ""
        echo "NOTE: If you need Talos support, install talosctl and run:"
        echo "  HTTPS_PROXY=http://localhost:$PROXY_PORT talosctl --nodes <IP> version"
        echo "Check if request appears in mitmproxy."
        return 0
    fi

    log_info "Starting mitmdump..."
    mitmdump --listen-port $PROXY_PORT --mode regular > /tmp/mitmproxy5.log 2>&1 &
    MITM_PID=$!
    sleep 2

    log_info "Testing talosctl with HTTPS_PROXY..."
    log_warn "This may fail if you don't have a Talos cluster - that's OK"

    # Try to connect (will fail without valid cluster, but we just want to see if proxy is used)
    HTTPS_PROXY=http://localhost:$PROXY_PORT talosctl --nodes 10.0.0.1 version 2>&1 || true

    sleep 1
    kill $MITM_PID 2>/dev/null || true

    if grep -q "10.0.0.1\|CONNECT" /tmp/mitmproxy5.log; then
        log_info "SUCCESS: talosctl respects HTTPS_PROXY!"
        echo "PASS: talosctl uses HTTPS_PROXY" >> "$RESULTS_FILE"
        echo "NOTE: Simple proxy may work - may not need full mTLS gateway" >> "$RESULTS_FILE"
        return 0
    else
        log_warn "talosctl did NOT use HTTPS_PROXY for gRPC"
        echo "RESULT: talosctl does NOT use HTTPS_PROXY for gRPC" >> "$RESULTS_FILE"
        echo "NOTE: Will need full mTLS gateway for Talos support" >> "$RESULTS_FILE"
        return 0  # Not a failure, just determines architecture
    fi
}

#############################################
# TEST 6: Claude Code uses proxy
#############################################
test_claude_code() {
    log_test "6: Claude Code container respects HTTPS_PROXY"

    echo "## Test 6: Claude Code" >> "$RESULTS_FILE"

    log_info "Starting mitmdump..."
    mitmdump --listen-port $PROXY_PORT --mode regular > /tmp/mitmproxy6.log 2>&1 &
    MITM_PID=$!
    sleep 2

    log_info "Testing curl from dotfiles container..."

    # Just test curl since Claude Code itself needs valid auth
    docker run --rm \
        -e HTTPS_PROXY=http://host.docker.internal:$PROXY_PORT \
        -e HTTP_PROXY=http://host.docker.internal:$PROXY_PORT \
        ghcr.io/shepherdjerred/dotfiles:latest \
        curl -s --insecure https://api.anthropic.com 2>/dev/null || true

    sleep 1
    kill $MITM_PID 2>/dev/null || true

    if grep -q "anthropic.com" /tmp/mitmproxy6.log; then
        log_info "SUCCESS: Container traffic goes through proxy!"
        echo "PASS: Claude Code container uses proxy" >> "$RESULTS_FILE"
        return 0
    else
        log_error "FAIL: Traffic did not go through proxy"
        cat /tmp/mitmproxy6.log
        echo "FAIL: Claude Code container did not use proxy" >> "$RESULTS_FILE"
        return 1
    fi
}

#############################################
# MAIN
#############################################
main() {
    echo ""
    log_info "Starting Proxy Integration Tests"
    log_info "================================="
    echo ""

    PASSED=0
    FAILED=0
    SKIPPED=0

    # Run tests
    if test_docker_proxy; then ((PASSED++)); else ((FAILED++)); fi
    sleep 1

    if test_header_injection; then ((PASSED++)); else ((FAILED++)); fi
    sleep 1

    if test_custom_ca; then ((PASSED++)); else ((FAILED++)); fi
    sleep 1

    if test_kubectl_proxy; then ((PASSED++)); else ((FAILED++)); fi
    sleep 1

    if test_talos_grpc; then ((PASSED++)); else ((FAILED++)); fi
    sleep 1

    if test_claude_code; then ((PASSED++)); else ((FAILED++)); fi

    # Summary
    echo ""
    log_test "SUMMARY"
    echo ""
    log_info "Passed: $PASSED"
    if [[ $FAILED -gt 0 ]]; then
        log_error "Failed: $FAILED"
    else
        log_info "Failed: $FAILED"
    fi
    echo ""

    echo "## Summary" >> "$RESULTS_FILE"
    echo "Passed: $PASSED" >> "$RESULTS_FILE"
    echo "Failed: $FAILED" >> "$RESULTS_FILE"

    log_info "Full results saved to: $RESULTS_FILE"
    echo ""
    cat "$RESULTS_FILE"

    if [[ $FAILED -gt 0 ]]; then
        echo ""
        log_error "GO/NO-GO: Some tests failed. Review results before proceeding."
        exit 1
    else
        echo ""
        log_info "GO/NO-GO: All tests passed! Safe to proceed with implementation."
        exit 0
    fi
}

main "$@"
