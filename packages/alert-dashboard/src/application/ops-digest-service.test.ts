import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  DigestInProgressError,
  DigestMailerUnconfiguredError,
  DigestSendError,
} from "#application/ops-errors";
import { fixedClock } from "#shared/time";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import { createOpsFixture } from "#test-fixtures/ops-services";

// Monday 2026-09-28 07:30 in Los Angeles.
const NOW = "2026-09-28T14:30:00Z";

async function fixture(options: { mailer?: boolean } = {}) {
  const created = createOpsFixture(fixedClock(NOW), options);
  await created.ops.ingest(
    JSON.stringify(
      fixtureOpsIngest(
        Temporal.Instant.from(NOW).subtract({ minutes: 1 }).toString(),
      ),
    ),
  );
  return created;
}

async function ingestClearSnapshot(
  ops: ReturnType<typeof createOpsFixture>,
  instant: Temporal.Instant,
  includeFixtureChanges = false,
): Promise<void> {
  const base = fixtureOpsIngest(instant.subtract({ minutes: 1 }).toString());
  await ops.ops.ingest(
    JSON.stringify({
      snapshot: {
        ...base.snapshot,
        severity: "ok",
        summary: "All monitored areas are healthy",
        sections: base.snapshot.sections.map((section) => ({
          ...section,
          severity: "ok",
          summary: "Healthy",
          signals: [],
        })),
      },
      changes: includeFixtureChanges ? base.changes : [],
    }),
  );
}

describe("digest runs", () => {
  it("sends each period exactly once and advances the digest cursor", async () => {
    const ops = await fixture();
    expect(await ops.digests.run("daily")).toMatchObject({
      status: "sent",
      duplicate: false,
    });
    expect(await ops.digests.run("daily")).toMatchObject({
      status: "sent",
      duplicate: true,
    });
    expect(ops.mail.sent).toHaveLength(1);
    const [message] = ops.mail.sent;
    expect(message?.messageId).toBe("<ops-digest-daily-2026-09-28@sjer.red>");
    expect(message?.subject).toBe("Daily digest: 4 items need your review");
    expect(message?.plainBody).toContain("Waiting on you");
    expect(message?.tag).toBe("ops-digest-daily");
    const cursor = await ops.repository.getCursor("digest");
    expect(cursor?.seenSignalIds).toContain("github:pr:3071");

    // After the cursor advanced, nothing is new for the next report.
    const report = await ops.digests.report("daily");
    expect(report.newSinceLast).toEqual([]);
  });

  it("marks a failed send and lets a retry send it", async () => {
    const ops = await fixture();
    ops.mail.failWith = new Error("Mail API returned 500");
    await expect(ops.digests.run("weekly")).rejects.toBeInstanceOf(
      DigestSendError,
    );
    expect(ops.repository.digests.get("weekly:2026-W40")?.status).toBe(
      "failed",
    );
    ops.mail.failWith = undefined;
    expect(await ops.digests.run("weekly")).toMatchObject({
      status: "sent",
      duplicate: false,
    });
    expect(ops.repository.digests.get("weekly:2026-W40")?.attempts).toBe(2);
  });

  it("refuses a concurrent send of the same period", async () => {
    const ops = await fixture();
    await ops.repository.claimDigestRun(
      {
        kind: "daily",
        periodKey: "2026-09-28",
        messageId: "<x@sjer.red>",
      },
      Temporal.Instant.from(NOW).epochNanoseconds,
      0n,
    );
    await expect(ops.digests.run("daily")).rejects.toBeInstanceOf(
      DigestInProgressError,
    );
  });

  it("fails loudly when enabled without a mailer", async () => {
    const ops = await fixture({ mailer: false });
    await expect(ops.digests.run("daily")).rejects.toBeInstanceOf(
      DigestMailerUnconfiguredError,
    );
  });

  it("sends the first clear daily digest, skips consecutive clear days, and emails again on recovery", async () => {
    let currentInstant = Temporal.Instant.from("2026-09-28T14:30:00Z");
    const clock = { now: () => currentInstant };
    const ops = createOpsFixture(clock, { dailyDigestQuietClear: true });

    const ingestClear = () => ingestClearSnapshot(ops, currentInstant);

    const ingestAttention = async () => {
      await ops.ops.ingest(
        JSON.stringify(
          fixtureOpsIngest(currentInstant.subtract({ minutes: 1 }).toString()),
        ),
      );
    };

    // Day 1 (clear, no prior daily digest): sends email and archives metadata.
    await ingestClear();
    expect(await ops.digests.run("daily")).toEqual({
      kind: "daily",
      periodKey: "2026-09-28",
      status: "sent",
      duplicate: false,
    });
    expect(ops.mail.sent).toHaveLength(1);
    expect(ops.repository.digests.get("daily:2026-09-28")).toMatchObject({
      status: "sent",
      severity: "ok",
      needsMeCount: 0,
      attentionCount: 0,
    });

    // Day 2 (consecutive clear day): skips email, archives full payload, advances cursor.
    currentInstant = currentInstant.add({ hours: 24 });
    await ingestClear();
    expect(await ops.digests.run("daily")).toEqual({
      kind: "daily",
      periodKey: "2026-09-29",
      status: "skipped",
      duplicate: false,
    });
    expect(ops.mail.sent).toHaveLength(1);
    const skippedRow = ops.repository.digests.get("daily:2026-09-29");
    expect(skippedRow).toMatchObject({
      status: "skipped",
      skipReason: "unchanged-clear",
      severity: "ok",
      needsMeCount: 0,
      attentionCount: 0,
    });
    expect(skippedRow?.reportPayload).not.toBeNull();
    expect(skippedRow?.htmlBody).toContain("All clear");
    expect(skippedRow?.plainBody).toContain("Open in Hub:");
    expect(await ops.digests.run("daily")).toEqual({
      kind: "daily",
      periodKey: "2026-09-29",
      status: "skipped",
      duplicate: true,
    });

    // Day 3 (attention needed): sends email.
    currentInstant = currentInstant.add({ hours: 24 });
    await ingestAttention();
    expect(await ops.digests.run("daily")).toEqual({
      kind: "daily",
      periodKey: "2026-09-30",
      status: "sent",
      duplicate: false,
    });
    expect(ops.mail.sent).toHaveLength(2);

    // Day 4 (recovery back to clear after attention day): MUST send recovery email!
    currentInstant = currentInstant.add({ hours: 24 });
    await ingestClear();
    expect(await ops.digests.run("daily")).toEqual({
      kind: "daily",
      periodKey: "2026-10-01",
      status: "sent",
      duplicate: false,
    });
    expect(ops.mail.sent).toHaveLength(3);

    // Day 5 (second clear day after recovery): skips again.
    currentInstant = currentInstant.add({ hours: 24 });
    await ingestClear();
    expect(await ops.digests.run("daily")).toEqual({
      kind: "daily",
      periodKey: "2026-10-02",
      status: "skipped",
      duplicate: false,
    });
    expect(ops.mail.sent).toHaveLength(3);
  });

  it("sends consecutive clear daily digests when dailyDigestQuietClear is false or changes occurred", async () => {
    let currentInstant = Temporal.Instant.from("2026-09-28T14:30:00Z");
    const ops = createOpsFixture(
      { now: () => currentInstant },
      { dailyDigestQuietClear: false },
    );

    await ingestClearSnapshot(ops, currentInstant);
    expect(await ops.digests.run("daily")).toMatchObject({ status: "sent" });
    currentInstant = currentInstant.add({ hours: 24 });
    await ingestClearSnapshot(ops, currentInstant);
    expect(await ops.digests.run("daily")).toMatchObject({ status: "sent" });
    expect(ops.mail.sent).toHaveLength(2);

    const quietOps = createOpsFixture(
      { now: () => currentInstant },
      { dailyDigestQuietClear: true },
    );
    await ingestClearSnapshot(quietOps, currentInstant);
    expect(await quietOps.digests.run("daily")).toMatchObject({
      status: "sent",
    });
    currentInstant = currentInstant.add({ hours: 24 });
    await ingestClearSnapshot(quietOps, currentInstant, true);
    expect(await quietOps.digests.run("daily")).toMatchObject({
      status: "sent",
    });
  });
});

describe("digest reports", () => {
  it("builds weekly trends from snapshots, Prometheus, and the ledger", async () => {
    const ops = await fixture({});
    ops.repository.incidents = {
      opened: 3,
      resolveDurationsNs: [600_000_000_000n, 1_800_000_000_000n],
    };
    const report = await ops.digests.report("weekly");
    expect(report.periodKey).toBe("2026-W40");
    const trends = Object.fromEntries(
      report.trends.map((trend) => [trend.id, trend]),
    );
    expect(trends["github.prs.merged_7d"]).toMatchObject({
      current: 23,
      previous: null,
    });
    expect(trends["ai.spend.mac_7d"]).toMatchObject({
      current: 24.25,
      previous: 18.5,
    });
    expect(trends["deploys"]).toMatchObject({ current: 1, previous: 0 });
    expect(report.incidents).toEqual({
      opened: 3,
      resolved: 2,
      medianMinutesToResolve: 20,
    });
    expect(
      report.newSinceLast.every((signal) => signal.since !== undefined),
    ).toBe(true);
  });

  it("reports unknown status before any snapshot exists", async () => {
    const ops = createOpsFixture(fixedClock(NOW));
    const report = await ops.digests.report("daily");
    expect(report.status).toEqual({
      severity: "unknown",
      summary: "No ops snapshot has been ingested yet",
      stale: true,
      snapshotGeneratedAt: null,
    });
  });
});
