import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decompressEnvelopePayload,
  extractPublicKey,
  MalformedEnvelopeError,
  PayloadTooLargeError,
  parseSentryEnvelope,
} from "#domain/envelope.ts";
import {
  computeFingerprint,
  extractIssueSummary,
  normalizeFrameLocation,
  parameterizeMessage,
} from "#domain/fingerprint.ts";
import {
  DEFAULT_REGRESSION_COOLDOWN_MS,
  evaluateIssueIngestion,
} from "#domain/lifecycle.ts";
import { createIngestRateLimiter } from "#domain/rate-limit.ts";
import {
  extractEventDetailViews,
  renderStacktraceMarkdown,
} from "#domain/stacktrace-markdown.ts";

const encoder = new TextEncoder();

describe("envelope decompression and parsing", () => {
  it("decompresses gzip, brotli, deflate, and identity payloads while rejecting zip bombs", () => {
    const sample = [
      JSON.stringify({
        event_id: "0123456789abcdef0123456789abcdef",
        dsn: "https://337945d2208840dca4a573be311a1bbb@logging.sjer.red/1",
      }),
      JSON.stringify({ type: "event" }),
      JSON.stringify({
        message: "hello from envelope",
        level: "warning",
        timestamp: 1_732_492_800.5,
        tags: [["env", "prod"]],
      }),
    ].join("\n");
    const raw = encoder.encode(sample);

    for (const [encoding, compressed] of [
      ["identity", raw],
      ["gzip", new Uint8Array(gzipSync(raw))],
      ["br", new Uint8Array(brotliCompressSync(raw))],
      ["deflate", new Uint8Array(deflateSync(raw))],
    ] as const) {
      const inflated = decompressEnvelopePayload(compressed, encoding);
      const parsed = parseSentryEnvelope(inflated);
      expect(parsed.publicKey).toBe("337945d2208840dca4a573be311a1bbb");
      expect(parsed.event?.message).toBe("hello from envelope");
      expect(parsed.event?.level).toBe("warning");
      expect(parsed.event?.tags).toEqual({ env: "prod" });
    }

    // 3 MiB of zeros compresses down to a few KiB (zip bomb) -> must fail closed with PayloadTooLargeError
    const bombUncompressed = new Uint8Array(3 * 1024 * 1024);
    const gzippedBomb = new Uint8Array(gzipSync(bombUncompressed));
    expect(gzippedBomb.byteLength).toBeLessThan(32 * 1024);
    expect(() => decompressEnvelopePayload(gzippedBomb, "gzip")).toThrow(
      PayloadTooLargeError,
    );

    const oversizedCompressed = new Uint8Array(1024 * 1024 + 10);
    expect(() =>
      decompressEnvelopePayload(oversizedCompressed, "identity"),
    ).toThrow(PayloadTooLargeError);

    expect(() => decompressEnvelopePayload(raw, "lz4")).toThrow(
      MalformedEnvelopeError,
    );
  });

  it("slices exact byte-length items containing embedded newlines and ignores non-event items", () => {
    const eventJson = JSON.stringify(
      {
        event_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Cannot read properties of undefined\nline two",
              stacktrace: {
                frames: [
                  {
                    filename: "https://sjer.red/assets/index-B9x8a12F.js?v=1",
                    function: "renderCard",
                    lineno: 42,
                    colno: 9,
                    in_app: true,
                    pre_context: ["const a = 1;"],
                    context_line: "return a.foo.bar;",
                    post_context: ["}"],
                    vars: { userId: 7 },
                  },
                ],
              },
            },
          ],
        },
        breadcrumbs: {
          values: [
            {
              timestamp: 1_732_492_800,
              category: "navigation",
              level: "info",
              message: "Opened dashboard",
            },
          ],
        },
      },
      null,
      2,
    );
    const eventBytes = encoder.encode(eventJson);
    const sessionBytes = encoder.encode(JSON.stringify({ sid: "123" }));
    const txBytes = encoder.encode(JSON.stringify({ transaction: "GET /" }));

    const envelopeText = [
      JSON.stringify({ sent_at: "2026-11-25T00:00:00Z" }),
      JSON.stringify({ type: "session", length: sessionBytes.byteLength }),
      new TextDecoder().decode(sessionBytes),
      JSON.stringify({ type: "event", length: eventBytes.byteLength }),
      eventJson,
      JSON.stringify({ type: "transaction", length: txBytes.byteLength }),
      new TextDecoder().decode(txBytes),
    ].join("\n");

    const parsed = parseSentryEnvelope(encoder.encode(envelopeText), {
      sentryAuthHeader:
        "Sentry sentry_version=7, sentry_client=sentry.javascript.bun/11.16.0, sentry_key=pub_key_123",
    });

    expect(parsed.publicKey).toBe("pub_key_123");
    expect(parsed.ignoredItemTypes).toEqual(["session", "transaction"]);
    expect(parsed.event?.eventId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(parsed.event?.exceptions).toHaveLength(1);
    expect(parsed.event?.breadcrumbs).toHaveLength(1);
  });

  it("extracts public key from Authorization header and query string fallbacks", () => {
    expect(
      extractPublicKey({
        authorizationHeader: "Sentry sentry_version=7, sentry_key=auth_key_99",
      }),
    ).toBe("auth_key_99");
    expect(extractPublicKey({ querySentryKey: "query_key_77" })).toBe(
      "query_key_77",
    );
  });
});

function makeFramedEvent(
  filename: string,
  lineno: number,
  fingerprint: string[] = [],
) {
  const envelope = [
    JSON.stringify({ dsn: "https://abc@logging.sjer.red/1" }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      fingerprint,
      release: "2026.11.25",
      environment: "production",
      platform: "javascript",
      transaction: "/matches/42",
      tags: { service: "scout" },
      breadcrumbs: Array.from({ length: 20 }, (_, idx) => ({
        timestamp: `2026-11-25T00:00:${String(idx).padStart(2, "0")}Z`,
        category: "http",
        level: "info",
        message: `step-${String(idx)}`,
      })),
      exception: {
        values: [
          {
            type: "RangeError",
            value: "Invalid array length",
            stacktrace: {
              frames: [
                {
                  filename: "node_modules/react-dom/index.js",
                  function: "renderWithHooks",
                  lineno: 100,
                  in_app: false,
                },
                {
                  filename,
                  function: "computeMatchTimeline",
                  lineno,
                  in_app: true,
                  pre_context: ["const rows = fetchRows();"],
                  context_line: "const out = new Array(rows.count);",
                  post_context: ["return out;"],
                  vars: { count: -1 },
                },
              ],
            },
          },
        ],
      },
    }),
  ].join("\n");
  const parsed = parseSentryEnvelope(encoder.encode(envelope));
  if (parsed.event === null) {
    throw new Error("Expected parsed event");
  }
  return parsed.event;
}

describe("fingerprinting and stacktrace markdown", () => {
  it("keeps fingerprint stable across line shifts and asset hashes while honoring {{ default }}", () => {
    const eventA = makeFramedEvent(
      "https://sjer.red/assets/match-AbCdEf12.js?cache=1",
      50,
    );
    const eventB = makeFramedEvent(
      "https://cdn.sjer.red/assets/match-99887766.js",
      188,
      ["{{ default }}"],
    );
    const eventCustom = makeFramedEvent(
      "https://cdn.sjer.red/assets/match-99887766.js",
      188,
      ["{{ default }}", "tenant-a"],
    );

    expect(
      normalizeFrameLocation("https://sjer.red/assets/match-AbCdEf12.js?x=1"),
    ).toBe("/assets/match.js");
    expect(computeFingerprint(eventA)).toBe(computeFingerprint(eventB));
    expect(computeFingerprint(eventCustom)).not.toBe(
      computeFingerprint(eventA),
    );

    const summary = extractIssueSummary(eventA);
    expect(summary).toEqual({
      type: "RangeError",
      value: "Invalid array length",
      transaction: "/matches/42",
      level: "error",
    });

    const md = renderStacktraceMarkdown(eventA);
    expect(md).toContain("# RangeError\nInvalid array length");
    expect(md).toContain("computeMatchTimeline` [in-app]");
    expect(md).toContain("> 50 | const out = new Array(rows.count);");
    expect(md).toContain('Vars: `{"count":-1}`');
    expect(md).toContain("## Tags\n- `service`: `scout`");
    expect(md).not.toContain("step-0");
    expect(md).toContain("step-19");

    const detail = extractEventDetailViews(eventA.rawData);
    expect(detail.exceptions[0]?.frames).toHaveLength(2);
    expect(detail.tags["service"]).toBe("scout");
  });

  it("parameterizes frameless captureMessage dynamic tokens deterministically", () => {
    const parameterized = parameterizeMessage(
      "Request 550e8400-e29b-41d4-a716-446655440000 token a1b2c3d4e5f60718293a at 2026-11-25T02:35:58Z to https://api.sjer.red/v1/items/99 failed after 3 retries",
    );
    expect(parameterized).toBe(
      "Request <uuid> token <hex> at <ts> to <url> failed after <num> retries",
    );
  });
});

describe("issue lifecycle transitions and token-bucket rate limiting", () => {
  it("handles OPEN, MUTED, RESOLVED, and RESOLVED_NEXT_RELEASE transitions with cooldown", () => {
    const t0 = new Date("2026-11-25T00:00:00Z");
    const created = evaluateIssueIngestion({
      existingIssue: null,
      incomingRelease: "1.0.0",
      incomingTimestamp: t0,
      alertOnNewIssue: true,
      alertOnRegression: true,
    });
    expect(created.state).toBe("OPEN");
    expect(created.outboxKind).toBe("NEW_ISSUE");

    const mutedStay = evaluateIssueIngestion({
      existingIssue: {
        state: "MUTED",
        resolvedInRelease: null,
        regressedCount: 0,
        lastAlertedAt: t0,
      },
      incomingRelease: "1.0.1",
      incomingTimestamp: new Date(t0.getTime() + 60_000),
      alertOnNewIssue: true,
      alertOnRegression: true,
    });
    expect(mutedStay.state).toBe("MUTED");
    expect(mutedStay.outboxKind).toBeNull();

    const sameReleaseIgnored = evaluateIssueIngestion({
      existingIssue: {
        state: "RESOLVED_NEXT_RELEASE",
        resolvedInRelease: "1.0.0",
        regressedCount: 0,
        lastAlertedAt: t0,
      },
      incomingRelease: "1.0.0",
      incomingTimestamp: new Date(t0.getTime() + 20 * 60_000),
      alertOnNewIssue: true,
      alertOnRegression: true,
    });
    expect(sameReleaseIgnored.state).toBe("RESOLVED_NEXT_RELEASE");
    expect(sameReleaseIgnored.regressed).toBe(false);
    expect(sameReleaseIgnored.outboxKind).toBeNull();

    const newReleaseRegressesWithinCooldown = evaluateIssueIngestion({
      existingIssue: {
        state: "RESOLVED_NEXT_RELEASE",
        resolvedInRelease: "1.0.0",
        regressedCount: 1,
        lastAlertedAt: t0,
      },
      incomingRelease: "1.1.0",
      incomingTimestamp: new Date(
        t0.getTime() + DEFAULT_REGRESSION_COOLDOWN_MS - 1000,
      ),
      alertOnNewIssue: true,
      alertOnRegression: true,
    });
    expect(newReleaseRegressesWithinCooldown.state).toBe("OPEN");
    expect(newReleaseRegressesWithinCooldown.regressedCount).toBe(2);
    expect(newReleaseRegressesWithinCooldown.outboxKind).toBeNull();

    const resolvedRegressesAfterCooldown = evaluateIssueIngestion({
      existingIssue: {
        state: "RESOLVED",
        resolvedInRelease: null,
        regressedCount: 2,
        lastAlertedAt: t0,
      },
      incomingRelease: "1.1.0",
      incomingTimestamp: new Date(
        t0.getTime() + DEFAULT_REGRESSION_COOLDOWN_MS + 1000,
      ),
      alertOnNewIssue: true,
      alertOnRegression: true,
    });
    expect(resolvedRegressesAfterCooldown.state).toBe("OPEN");
    expect(resolvedRegressesAfterCooldown.regressedCount).toBe(3);
    expect(resolvedRegressesAfterCooldown.outboxKind).toBe("REGRESSION");
  });

  it("enforces per-project and per-IP token buckets and emits X-Sentry-Rate-Limits format", () => {
    const limiter = createIngestRateLimiter({
      projectBurst: 3,
      projectRefillPerSec: 1,
      ipBurst: 2,
      ipRefillPerSec: 0.5,
    });

    expect(
      limiter.consume({ projectId: 1, ip: "10.0.0.1", nowMs: 1000 }).allowed,
    ).toBe(true);
    expect(
      limiter.consume({ projectId: 1, ip: "10.0.0.1", nowMs: 1000 }).allowed,
    ).toBe(true);
    const blockedIp = limiter.consume({
      projectId: 1,
      ip: "10.0.0.1",
      nowMs: 1000,
    });
    expect(blockedIp).toEqual({
      allowed: false,
      retryAfterSeconds: 2,
      rateLimitHeader: "2:error:project",
    });

    // Different IP still has 1 token left in project bucket
    expect(
      limiter.consume({ projectId: 1, ip: "10.0.0.2", nowMs: 1000 }).allowed,
    ).toBe(true);
    const blockedProject = limiter.consume({
      projectId: 1,
      ip: "10.0.0.3",
      nowMs: 1000,
    });
    expect(blockedProject.allowed).toBe(false);
    expect(blockedProject.rateLimitHeader).toBe("1:error:project");
  });
});
