import { describe, expect, test } from "bun:test";

import { isTransientError, TransientError } from "./transient.ts";

describe("isTransientError", () => {
  test.each([
    // GitHub GraphQL 500 envelope (release-please, build 5809)
    "Request failed due to following response errors:\n - Something went wrong while executing your query on 2026-07-19T18:47:15Z.",
    // kyverno admission webhook flap surfaced through an ArgoCD sync operation
    'Sync operation Failed for apps: Internal error occurred: failed calling webhook "validate.kyverno.svc-fail": Post "https://kyverno-svc.kyverno.svc:443/validate/fail?timeout=10s": dial tcp 10.98.143.55:443: connect: connection refused',
    "HTTP 502 Bad Gateway",
    "503 Service Unavailable",
    "Gateway Timeout",
    // Helm's upstream error spelling from argocd-helm-render.test.ts.
    "504 Gateway Time-out",
    "npm token introspection failed (page 1): HTTP 504 Gateway Timeout",
    "npm token introspection failed (page 1): HTTP 507 Insufficient Storage",
    "Unable to connect. Is the computer able to access the url?",
    "Failed to open socket",
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
    // ArgoCD code 9: an overlapping sync op still holds the app (build 6296).
    'Sync failed: HTTP 400 Bad Request\n{"error":"another operation is already in progress","code":9,"message":"another operation is already in progress"}',
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
    // Source locations in an Error stack are not HTTP status codes.
    "logical readiness failure\n    at reconcile (argocd.ts:515:11)",
  ])("not transient: %s", (message) => {
    expect(isTransientError(new Error(message))).toBe(false);
  });

  test("handles non-Error values", () => {
    expect(isTransientError("ECONNREFUSED")).toBe(true);
    expect(isTransientError("plain failure")).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });

  test("recognizes an explicit TransientError regardless of message", () => {
    // The caller already classified this as transient (e.g. a BuildKit
    // signature like `context deadline exceeded` that the general pattern does
    // not list); the brand must make runMain retry it.
    expect(
      isTransientError(new TransientError("context deadline exceeded")),
    ).toBe(true);
    expect(isTransientError(new TransientError("no pattern match here"))).toBe(
      true,
    );
  });

  test("recognizes Bun transport codes through the cause chain", () => {
    expect(
      isTransientError({
        code: "FetchFailed",
        cause: { code: "ConnectionRefused" },
      }),
    ).toBe(true);
    expect(
      isTransientError({
        message: "request rejected",
        cause: { code: "ValidationFailed" },
      }),
    ).toBe(false);
  });
});
