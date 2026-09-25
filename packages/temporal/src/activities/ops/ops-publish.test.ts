import { describe, expect, test } from "vitest";
import { findSection } from "@shepherdjerred/ops-model/assemble.ts";
import {
  SOURCE_IDS,
  type SourceId,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { register } from "#observability/metrics.ts";
import {
  buildOpsIngest,
  dedupeChanges,
  publishOpsIngest,
  recordSourceSuccesses,
  redactFailure,
  triggerDigest,
  type OpsCollectorOutcome,
  type OpsPoster,
} from "./ops-publish.ts";

const now = new Date("2026-09-24T12:00:00.000Z");

function ok(source: SourceId): OpsCollectorOutcome {
  return {
    source,
    ok: true,
    result: {
      status: {
        source,
        ok: true,
        observedAt: now.toISOString(),
        durationMs: 5,
      },
      signals: [],
      metrics: [],
      changes: [],
    },
  };
}

function outcomes(
  failed: Partial<Record<SourceId, string>> = {},
): OpsCollectorOutcome[] {
  return SOURCE_IDS.map((source) => {
    const error = failed[source];
    return error === undefined ? ok(source) : { source, ok: false, error };
  });
}

describe("buildOpsIngest", () => {
  test("a failed source is unknown, redacted, and keeps its last success", () => {
    const ingest = buildOpsIngest({
      outcomes: outcomes({
        linear: "linear: HTTP 401 for key lin_api_supersecret",
      }),
      now,
      lastSuccess: new Map([["linear", "2026-09-24T11:55:00.000Z"]]),
      secrets: ["lin_api_supersecret"],
    });
    const status = ingest.snapshot.sources.find((s) => s.source === "linear");
    expect(status).toEqual({
      source: "linear",
      ok: false,
      observedAt: now.toISOString(),
      durationMs: 0,
      error: "linear: HTTP 401 for key ***",
      lastSuccessAt: "2026-09-24T11:55:00.000Z",
    });
    expect(findSection(ingest.snapshot, "work").severity).toBe("unknown");
    expect(
      ingest.snapshot.sources.find((s) => s.source === "alerts")?.lastSuccessAt,
    ).toBe(now.toISOString());
  });

  test("carries signals, metrics, and deduplicated changes", () => {
    const all = outcomes();
    const github = all.find((outcome) => outcome.source === "github");
    if (!github?.ok) {
      throw new Error("fixture");
    }
    const change = {
      source: "github" as const,
      externalId: "pr:1",
      kind: "merge" as const,
      title: "#1 merged",
      occurredAt: now.toISOString(),
    };
    github.result.signals.push({
      id: "github:pr:2",
      source: "github",
      section: "delivery",
      kind: "pull-request",
      severity: "info",
      needsMe: true,
      title: "#2 ready",
    });
    github.result.changes.push(change, { ...change, title: "duplicate" });
    const ingest = buildOpsIngest({
      outcomes: all,
      now,
      lastSuccess: new Map(),
      secrets: [],
    });
    expect(ingest.changes).toEqual([{ ...change, severity: "info" }]);
    expect(findSection(ingest.snapshot, "delivery").signals[0]?.needsMe).toBe(
      true,
    );
  });

  test("a missing or doubled source is a broken workflow contract", () => {
    expect(() =>
      buildOpsIngest({
        outcomes: outcomes().slice(1),
        now,
        lastSuccess: new Map(),
        secrets: [],
      }),
    ).toThrow(/cover each source once/);
    expect(() =>
      buildOpsIngest({
        outcomes: [...outcomes(), ok("ai")],
        now,
        lastSuccess: new Map(),
        secrets: [],
      }),
    ).toThrow(/cover each source once/);
  });
});

describe("helpers", () => {
  test("redaction bounds length and flattens whitespace", () => {
    expect(redactFailure("a\n  b token12345", ["token12345"])).toBe("a b ***");
    expect(redactFailure("x".repeat(500), []).length).toBe(300);
  });

  test("dedupe keeps the first of each source and external id", () => {
    const base = {
      kind: "deploy" as const,
      title: "t",
      occurredAt: now.toISOString(),
    };
    expect(
      dedupeChanges([
        { ...base, source: "argocd", externalId: "a" },
        { ...base, source: "github", externalId: "a" },
        { ...base, source: "argocd", externalId: "a", title: "later" },
      ]).map(
        (change) => `${change.source}:${change.externalId}:${change.title}`,
      ),
    ).toEqual(["argocd:a:t", "github:a:t"]);
  });

  test("records successes in the freshness gauge", async () => {
    const lastSuccess = new Map<SourceId, string>();
    recordSourceSuccesses(outcomes({ ai: "down" }), lastSuccess);
    expect(lastSuccess.has("ai")).toBe(false);
    expect(lastSuccess.get("alerts")).toBe(now.toISOString());
    const text = await register.metrics();
    expect(text).toContain(
      `ops_snapshot_source_last_success_timestamp_seconds{source="alerts",component="temporal-worker"} ${String(now.getTime() / 1000)}`,
    );
  });
});

describe("delivery to the dashboard", () => {
  test("posts the ingest with the bearer token and summarizes it", async () => {
    const posts: Parameters<OpsPoster>[0][] = [];
    const post: OpsPoster = (input) => {
      posts.push(input);
      return Promise.resolve();
    };
    const ingest = buildOpsIngest({
      outcomes: outcomes({ talos: "talosctl exited 1" }),
      now,
      lastSuccess: new Map(),
      secrets: [],
    });
    const summary = await publishOpsIngest({
      ingest,
      dashboardUrl: "http://alert-dashboard:7341",
      token: "ingest-token",
      post,
    });
    expect(posts[0]).toMatchObject({
      url: "http://alert-dashboard:7341/internal/v1/ops/snapshots",
      token: "ingest-token",
      body: ingest,
    });
    expect(summary).toMatchObject({
      severity: "unknown",
      failedSources: ["talos"],
      signals: 0,
      changes: 0,
    });
  });

  test("a digest trigger posts to the kind's endpoint", async () => {
    const urls: string[] = [];
    await expect(
      triggerDigest({
        kind: "weekly",
        dashboardUrl: "http://alert-dashboard:7341",
        token: "t",
        post: ({ url }) => {
          urls.push(url);
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ kind: "weekly" });
    expect(urls).toEqual([
      "http://alert-dashboard:7341/internal/v1/digests/weekly",
    ]);
  });

  test("a dashboard rejection propagates so the Activity retries", async () => {
    const ingest = buildOpsIngest({
      outcomes: outcomes(),
      now,
      lastSuccess: new Map(),
      secrets: [],
    });
    await expect(
      publishOpsIngest({
        ingest,
        dashboardUrl: "http://alert-dashboard:7341",
        token: "t",
        post: () => Promise.reject(new Error("POST returned HTTP 503")),
      }),
    ).rejects.toThrow(/503/);
  });
});
