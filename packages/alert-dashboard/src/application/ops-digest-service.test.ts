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

async function fixture(options: { digestEnabled?: boolean; mailer?: boolean }) {
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

describe("digest runs", () => {
  it("records a skipped run and sends nothing while the flag is off", async () => {
    const ops = await fixture({ digestEnabled: false });
    expect(await ops.digests.run("daily")).toEqual({
      kind: "daily",
      periodKey: "2026-09-28",
      status: "skipped",
      duplicate: false,
    });
    expect(await ops.digests.run("daily")).toMatchObject({
      status: "skipped",
      duplicate: true,
    });
    expect(ops.postal.sent).toHaveLength(0);
    // Enabling the flag later does not resend a period already skipped.
    ops.gate.enabled = true;
    expect(await ops.digests.run("daily")).toMatchObject({
      status: "skipped",
      duplicate: true,
    });
    expect(ops.postal.sent).toHaveLength(0);
  });

  it("sends each period exactly once and advances the digest cursor", async () => {
    const ops = await fixture({ digestEnabled: true });
    expect(await ops.digests.run("daily")).toMatchObject({
      status: "sent",
      duplicate: false,
    });
    expect(await ops.digests.run("daily")).toMatchObject({
      status: "sent",
      duplicate: true,
    });
    expect(ops.postal.sent).toHaveLength(1);
    const [message] = ops.postal.sent;
    expect(message?.messageId).toBe("<ops-digest-daily-2026-09-28@sjer.red>");
    expect(message?.subject).toBe(
      "[Ops] Daily digest 2026-09-28: 4 waiting on you",
    );
    expect(message?.plainBody).toContain("Waiting on you:");
    expect(message?.tag).toBe("ops-digest-daily");
    const cursor = await ops.repository.getCursor("digest");
    expect(cursor?.seenSignalIds).toContain("github:pr:3071");

    // After the cursor advanced, nothing is new for the next report.
    const report = await ops.digests.report("daily");
    expect(report.newSinceLast).toEqual([]);
  });

  it("marks a failed send and lets a retry send it", async () => {
    const ops = await fixture({ digestEnabled: true });
    ops.postal.failWith = new Error("Postal returned 500");
    await expect(ops.digests.run("weekly")).rejects.toBeInstanceOf(
      DigestSendError,
    );
    expect(ops.repository.digests.get("weekly:2026-W40")?.status).toBe(
      "failed",
    );
    ops.postal.failWith = undefined;
    expect(await ops.digests.run("weekly")).toMatchObject({
      status: "sent",
      duplicate: false,
    });
    expect(ops.repository.digests.get("weekly:2026-W40")?.attempts).toBe(2);
  });

  it("refuses a concurrent send of the same period", async () => {
    const ops = await fixture({ digestEnabled: true });
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
    const ops = await fixture({ digestEnabled: true, mailer: false });
    await expect(ops.digests.run("daily")).rejects.toBeInstanceOf(
      DigestMailerUnconfiguredError,
    );
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
