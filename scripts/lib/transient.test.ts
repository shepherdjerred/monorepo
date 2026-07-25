import { describe, expect, test } from "bun:test";

import { isTransientError } from "./transient.ts";

describe("isTransientError", () => {
  test.each([
    // GitHub GraphQL 500 envelope (release-please, build 5809)
    "Request failed due to following response errors:\n - Something went wrong while executing your query on 2026-07-19T18:47:15Z.",
    // kyverno admission webhook flap surfaced through an ArgoCD sync operation
    'Sync operation Failed for apps: Internal error occurred: failed calling webhook "validate.kyverno.svc-fail": Post "https://kyverno-svc.kyverno.svc:443/validate/fail?timeout=10s": dial tcp 10.98.143.55:443: connect: connection refused',
    "HTTP 502 Bad Gateway",
    "503 Service Unavailable",
    "Gateway Timeout",
    "read tcp: connection reset by peer",
    "getaddrinfo EAI_AGAIN api.github.com",
    "fetch failed: ECONNRESET",
    "net/http: TLS handshake timeout",
    // Go's lowercase TLS handshake variant (distinct from "TLS handshake").
    'Get "https://ghcr.io/v2/": remote error: tls: handshake failure',
    "Error: 500 Internal Server Error",
    "You have exceeded a secondary rate limit",
    // Reverse-proxy 5xx page that reports "Proxy Error" without a numeric code.
    "The proxy server received an invalid response. Proxy Error",
    // Go net i/o timeout (distinct from the ETIMEDOUT errno spelling).
    "read tcp 10.0.0.5:51234->140.82.113.3:443: i/o timeout",
    // Node/libuv connect timeout errno.
    "connect ETIMEDOUT 140.82.113.3:443",
    // DNS resolution flap (getaddrinfo temporary failure).
    "curl: (6) Could not resolve host: temporary failure in name resolution",
  ])("transient: %s", (message) => {
    expect(isTransientError(new Error(message))).toBe(true);
  });

  test.each([
    // A missing chart/image/tag is a bad pin, never retryable.
    "failed to fetch https://charts.example.com/foo-1.2.3.tgz : 404 Not Found",
    "ghcr.io/tbxark/mcp-proxy@sha256:abc: not found",
    // Logical failures.
    "Sync operation Failed for apps: template validation error",
    "version commit-back PR number is empty",
    "Command failed (exit 1): tofu apply",
    "lockfile had changes, but lockfile is frozen",
  ])("not transient: %s", (message) => {
    expect(isTransientError(new Error(message))).toBe(false);
  });

  test("handles non-Error values", () => {
    expect(isTransientError("ECONNREFUSED")).toBe(true);
    expect(isTransientError("plain failure")).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});
