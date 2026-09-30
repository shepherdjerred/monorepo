import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ServiceNotFoundError,
  SnapshotUnavailableError,
} from "#application/ops-errors";
import { InstantTextSchema, type Clock } from "#shared/time";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import { createOpsFixture } from "#test-fixtures/ops-services";

const NOW = "2026-09-24T12:00:00Z";

function clockAt(value: string): Clock & { set: (next: string) => void } {
  let instant = Temporal.Instant.from(value);
  return {
    now: () => instant,
    set: (next) => {
      instant = Temporal.Instant.from(next);
    },
  };
}

async function ingested(clock = clockAt(NOW)) {
  const fixture = createOpsFixture(clock);
  await fixture.ops.ingest(JSON.stringify(fixtureOpsIngest(NOW)));
  return { fixture, clock };
}

describe("ops ingest", () => {
  it("rejects malformed JSON and bodies that violate the ops-model contract", async () => {
    const fixture = createOpsFixture(clockAt(NOW));
    await expect(fixture.ops.ingest("{not json")).rejects.toBeInstanceOf(
      z.ZodError,
    );
    const body = fixtureOpsIngest(NOW);
    await expect(
      fixture.ops.ingest(
        JSON.stringify({
          ...body,
          snapshot: { ...body.snapshot, schemaVersion: 2 },
        }),
      ),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      fixture.ops.ingest(JSON.stringify({ ...body, extra: true })),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(fixture.repository.snapshots).toHaveLength(0);
  });

  it("stores the snapshot and deduplicates change events by source and id", async () => {
    const { fixture } = await ingested();
    await fixture.ops.ingest(JSON.stringify(fixtureOpsIngest(NOW)));
    expect(fixture.repository.changes.size).toBe(3);
    expect(fixture.repository.snapshots.length).toBeGreaterThan(0);
  });
});

describe("snapshot freshness and cursor", () => {
  it("answers 'unavailable' before the first ingest", async () => {
    const fixture = createOpsFixture(clockAt(NOW));
    await expect(fixture.ops.snapshot()).rejects.toBeInstanceOf(
      SnapshotUnavailableError,
    );
  });

  it("degrades a stale snapshot to unknown at read time", async () => {
    const { fixture, clock } = await ingested();
    const fresh = await fixture.ops.snapshot();
    expect(fresh.stale).toBe(false);
    clock.set("2026-09-24T12:20:00Z");
    const stale = await fixture.ops.snapshot();
    expect(stale.stale).toBe(true);
    expect(stale.sections.every((section) => section.severity !== "ok")).toBe(
      true,
    );
    expect(stale.summary).toMatch(/^Snapshot is 20 minutes old/u);
  });

  it("reports signals missing from the viewer's cursor as new", async () => {
    const { fixture } = await ingested();
    const first = await fixture.ops.snapshot("web");
    const allIds = first.sections.flatMap((section) =>
      section.signals.map((signal) => signal.id),
    );
    expect(first.newSignalIds.toSorted()).toEqual(allIds.toSorted());

    const seen = allIds.filter((id) => id !== "github:pr:3071");
    const cursor = await fixture.ops.putCursor({
      consumer: "web",
      seenSignalIds: [...seen, seen[0]],
    });
    expect(cursor.seenCount).toBe(seen.length);
    const afterCursor = await fixture.ops.snapshot("web");
    expect(afterCursor.newSignalIds).toEqual(["github:pr:3071"]);
    const withoutConsumer = await fixture.ops.snapshot();
    expect(withoutConsumer.newSignalIds).toEqual([]);
  });

  it("refuses to let the browser write the digest cursor", async () => {
    const fixture = createOpsFixture(clockAt(NOW));
    await expect(
      fixture.ops.putCursor({ consumer: "digest", seenSignalIds: [] }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe("service detail join", () => {
  it("joins signals, stored changes, alert changes, and links by catalog id", async () => {
    const { fixture } = await ingested();
    fixture.repository.alertLedger = [
      {
        eventId: "event-scout",
        occurrenceId: `alert_${"a".repeat(32)}`,
        type: "opened",
        occurredAtNs: Temporal.Instant.from("2026-09-24T11:30:00Z")
          .epochNanoseconds,
        alertname: "PodCrashLooping",
        namespace: "scout-prod",
        severity: "critical",
        summary: "scout worker crash looping",
      },
      {
        eventId: "event-other",
        occurrenceId: `alert_${"b".repeat(32)}`,
        type: "opened",
        occurredAtNs: Temporal.Instant.from("2026-09-24T11:40:00Z")
          .epochNanoseconds,
        alertname: "DiskFull",
        namespace: "velero",
        severity: "warning",
        summary: "disk",
      },
    ];
    // Aliases resolve to the same service.
    const detail = await fixture.ops.serviceDetail("scout");
    expect(detail.service.id).toBe("scout-for-lol");
    expect(detail.signals.map((signal) => signal.id)).toEqual([
      "argocd:scout-beta",
    ]);
    expect(detail.changes.map((change) => change.kind)).toEqual([
      "alert-open",
      "sync",
      "merge",
    ]);
    expect(detail.changes[0]).toMatchObject({
      service: "scout-for-lol",
      severity: "error",
      url: `https://alerts.tailnet-1a49.ts.net/alerts/alert_${"a".repeat(32)}`,
    });
    expect(detail.links.map((link) => link.kind)).toContain("logs");
    expect(detail.snapshotGeneratedAt).toBe(NOW);
  });

  it("reports an unknown service as not found", async () => {
    const fixture = createOpsFixture(clockAt(NOW));
    await expect(fixture.ops.serviceDetail("nope")).rejects.toBeInstanceOf(
      ServiceNotFoundError,
    );
    await expect(
      fixture.ops.changes({ service: "nope", limit: 10 }),
    ).rejects.toBeInstanceOf(ServiceNotFoundError);
  });

  it("filters the timeline by service and time", async () => {
    const { fixture } = await ingested();
    const birmel = await fixture.ops.changes({ service: "birmel", limit: 10 });
    expect(birmel.map((change) => change.title)).toEqual([
      "birmel deployed 2.14.0",
    ]);
    const recent = await fixture.ops.changes({
      since: InstantTextSchema.parse("2026-09-24T10:00:00Z"),
      limit: 10,
    });
    expect(recent.map((change) => change.kind)).toEqual(["sync"]);
  });
});

describe("series presets", () => {
  it("names series by the preset's legend label on one step grid", async () => {
    const fixture = createOpsFixture(clockAt(NOW));
    const result = await fixture.ops.series({
      preset: "ai-cost-by-source",
      range: "24h",
    });
    expect(result.unit).toBe("usd");
    expect(result.series.map((entry) => entry.name)).toEqual([
      "claude-code",
      "codex",
      "cursor",
    ]);
    expect(fixture.series.requests[0]?.promql).toBe(
      "sum by (source) (increase(ai_usage_cost_usd_total[300s]))",
    );
    expect(result.stepSeconds).toBe(300);
  });
});
