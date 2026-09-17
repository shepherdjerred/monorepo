import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { ArtifactKindSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { scoutDurableLakeStagingLag } from "#src/metrics/durable-pipeline.ts";
import { collectLakeStagingLagMetrics } from "#src/report-lake/lake-staging-lag.ts";
import {
  lakeStagingReceiptKind,
  rawArchiveReceiptKind,
} from "#src/report-lake/durable-receipts.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { gaugeValue } from "#src/testing/gauge-values.ts";

/**
 * The lake staging lag sweep, run against a real Postgres.
 *
 * This lives beside the sweep rather than beside the other durable-metric
 * tests for the same reason the sweep itself does: the receipt-kind vocabulary
 * belongs to `report-lake/`, and `architecture.config.ts` forbids `metrics/`
 * from importing this layer — a test in `metrics/` that reached for
 * `rawArchiveReceiptKind` would break the boundary its subject exists to
 * respect. Importing the gauge in this direction is the permitted one.
 *
 * What needs proving here is the anti-join. The lag is not a column: it is
 * "archived, with no staging receipt", and a query that got that backwards
 * would report a lake with a large backlog as perfectly current.
 */

const { prisma } = createTestDatabase("lake-staging-lag-metrics");

afterAll(async () => {
  await prisma.$disconnect();
});

const MATCH_ID = "NA1_9200";
const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;

async function seedReceipt(
  matchId: string,
  kind: string,
  recordedAt: Date,
): Promise<void> {
  await prisma.matchProcessingReceipt.create({
    data: {
      riotMatchId: matchId,
      kind,
      version: 1,
      scopeKind: "global",
      scopeKey: "global",
      evidence: null,
      recordedAt,
    },
  });
}

beforeEach(async () => {
  await prisma.matchProcessingReceipt.deleteMany();
  scoutDurableLakeStagingLag.reset();
});

describe("lake staging lag sweep against Postgres", () => {
  test("ages an archive that has no staging receipt, per artifact kind", async () => {
    const archivedAt = new Date(NOW - 3 * HOUR_MS);
    // A match archived and never staged: the lake owes this one.
    await seedReceipt(MATCH_ID, rawArchiveReceiptKind("match"), archivedAt);
    // A timeline archived AND staged: settled, so it must not register lag.
    // This is the pair that proves the anti-join rather than a plain scan —
    // both receipts exist for the same match, and only the unmatched one counts.
    await seedReceipt(MATCH_ID, rawArchiveReceiptKind("timeline"), archivedAt);
    await seedReceipt(
      MATCH_ID,
      lakeStagingReceiptKind("timeline"),
      new Date(NOW),
    );

    await collectLakeStagingLagMetrics(prisma);

    const matchLag = await gaugeValue(scoutDurableLakeStagingLag, {
      artifact_kind: "match",
    });
    expect(matchLag).toBeGreaterThan(2.5 * 3600);
    expect(matchLag).toBeLessThan(3.5 * 3600);
    expect(
      await gaugeValue(scoutDurableLakeStagingLag, {
        artifact_kind: "timeline",
      }),
    ).toBe(0);
    // Every artifact kind gets a series even with nothing archived at all, so
    // an unused kind reads as current rather than going absent.
    expect(
      await gaugeValue(scoutDurableLakeStagingLag, {
        artifact_kind: "prematch",
      }),
    ).toBe(0);
    expect(ArtifactKindSchema.options).toHaveLength(3);
  });

  test("takes the oldest unstaged archive when several are waiting", async () => {
    // The read groups by match and orders by the earliest recording, so the
    // lag has to be the longest wait rather than whichever row came back first.
    await seedReceipt(
      "NA1_9201",
      rawArchiveReceiptKind("match"),
      new Date(NOW - HOUR_MS),
    );
    await seedReceipt(
      "NA1_9202",
      rawArchiveReceiptKind("match"),
      new Date(NOW - 8 * HOUR_MS),
    );

    await collectLakeStagingLagMetrics(prisma);

    const lag = await gaugeValue(scoutDurableLakeStagingLag, {
      artifact_kind: "match",
    });
    expect(lag).toBeGreaterThan(7.5 * 3600);
    expect(lag).toBeLessThan(8.5 * 3600);
  });
});
