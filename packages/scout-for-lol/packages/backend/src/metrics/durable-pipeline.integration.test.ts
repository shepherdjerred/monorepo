import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  collectDurablePipelineMetrics,
  scoutDurableBacklogOldestAge,
  scoutDurableNotificationIntents,
  scoutDurableObservationLag,
  scoutDurableRecoveryBatches,
} from "#src/metrics/durable-pipeline.ts";
import { gaugeValue } from "#src/testing/gauge-values.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";

/**
 * The durable sweeps, run against a real Postgres.
 *
 * The unit test beside this one proves the gauges are registered once and
 * carry only bounded labels. It cannot prove the queries behind them WORK:
 * they are the only code in the module that touches the database, they run
 * exclusively inside `getMetrics()` behind the sweep capability, and a
 * `groupBy` shape or a three-table raw anti-join is exactly the kind of thing
 * that typechecks and then returns the wrong rows.
 *
 * The lake staging lag is the one family not covered here; its sweep lives in
 * `report-lake/`, which `metrics/` may not import, so it is tested beside the
 * code that owns it in `lake-staging-lag.integration.test.ts`.
 *
 * Without this file the first executor of those queries would be a beta pod,
 * and the failure mode is quiet: every read is wrapped, so a broken query
 * writes a sentinel instead of failing the scrape. An operator would see a
 * gauge, not an error. So both halves are asserted here — the seeded values on
 * the happy path, and the sentinel shape on the degraded one.
 */

const { prisma } = createTestDatabase("durable-pipeline-metrics");

afterAll(async () => {
  await prisma.$disconnect();
});

const MATCH_ID = "NA1_9100";
const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;

/**
 * One intent in a given state, with the columns that state requires.
 *
 * The schema does not merely store a state string: paired CHECK constraints
 * tie each state to the evidence it must and must not carry, so
 * `unknown-delivery` without its attempt nonce and observation time is
 * rejected outright. Honouring that here is the point rather than an
 * obstacle — a seed the database would refuse is not a row the sweep will ever
 * be asked to count.
 */
async function seedIntent(state: string, key: string): Promise<void> {
  const isUnknownDelivery = state === "unknown-delivery";
  await prisma.matchNotificationIntent.create({
    data: {
      intentKey: key,
      riotMatchId: MATCH_ID,
      kind: "postmatch",
      originKind: "live",
      targetKind: "channel",
      targetId: "300000000000000001",
      state,
      attemptNonce: isUnknownDelivery ? `${key}-nonce` : null,
      // Only reachable after beginSend, which mints the nonce AND increments
      // the count; the schema refuses an unknown delivery that never attempted.
      attemptCount: isUnknownDelivery ? 1 : 0,
      unknownObservedAt: isUnknownDelivery ? new Date(NOW - HOUR_MS) : null,
      freshnessDeadline: new Date(NOW + HOUR_MS),
      // A DB CHECK pins the envelope kind; the column is not free-form JSON.
      payload: JSON.stringify({
        kind: "notification-intent",
        version: 1,
        data: {},
      }),
      createdAt: new Date(NOW - HOUR_MS),
      updatedAt: new Date(NOW - HOUR_MS),
    },
  });
}

async function seedRecoveryBatch(
  state: string,
  id: string,
  createdAt: Date,
): Promise<void> {
  await prisma.matchRecoveryBatch.create({
    data: {
      recoveryBatchId: id,
      policy: "normal",
      state,
      createdAt,
      updatedAt: createdAt,
    },
  });
}

beforeEach(async () => {
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.matchRecoveryBatch.deleteMany();
  await prisma.scoutWorkflowStart.deleteMany();
  await prisma.matchObservation.deleteMany();
  scoutDurableNotificationIntents.reset();
  scoutDurableObservationLag.reset();
  scoutDurableRecoveryBatches.reset();
  scoutDurableBacklogOldestAge.reset();
});

describe("durable pipeline sweep against Postgres", () => {
  test("counts notification intents into the state they are stored in", async () => {
    await seedIntent("pending", `${MATCH_ID}:a`);
    await seedIntent("pending", `${MATCH_ID}:b`);
    await seedIntent("unknown-delivery", `${MATCH_ID}:c`);

    await collectDurablePipelineMetrics(prisma);

    expect(
      await gaugeValue(scoutDurableNotificationIntents, { state: "pending" }),
    ).toBe(2);
    expect(
      await gaugeValue(scoutDurableNotificationIntents, {
        state: "unknown-delivery",
      }),
    ).toBe(1);
    // The zero-fill is the load-bearing half: a state with no rows must read 0,
    // not go absent, or a drained queue and a dead sweep look identical.
    expect(
      await gaugeValue(scoutDurableNotificationIntents, { state: "delivered" }),
    ).toBe(0);
  });

  test("counts recovery batches by state and ages the oldest live one", async () => {
    const sixHoursAgo = new Date(NOW - 6 * HOUR_MS);
    // `planned` rather than `scanning`: a scanning batch must carry its page
    // counters (MatchRecoveryBatch_cursor_presence_check), and the liveness
    // classification under test treats both states as live either way.
    await seedRecoveryBatch("planned", "batch-live", sixHoursAgo);
    // `complete` is terminal, so it must count in its own series and must NOT
    // be what the age gauge measures — an ancient finished batch is not a
    // backlog, and letting it set the age would page on healthy history.
    await seedRecoveryBatch(
      "complete",
      "batch-done",
      new Date(NOW - 48 * HOUR_MS),
    );

    await collectDurablePipelineMetrics(prisma);

    expect(
      await gaugeValue(scoutDurableRecoveryBatches, { state: "planned" }),
    ).toBe(1);
    expect(
      await gaugeValue(scoutDurableRecoveryBatches, { state: "complete" }),
    ).toBe(1);
    expect(
      await gaugeValue(scoutDurableRecoveryBatches, { state: "scanning" }),
    ).toBe(0);

    const age = await gaugeValue(scoutDurableBacklogOldestAge, {
      family: "live-recovery-batches",
    });
    expect(age).toBeGreaterThan(5.5 * 3600);
    expect(age).toBeLessThan(6.5 * 3600);
  });

  test("ages the oldest workflow start that was never accepted", async () => {
    const requestedAt = new Date(NOW - 2 * HOUR_MS);
    await prisma.scoutWorkflowStart.createMany({
      data: [
        {
          requestId: crypto.randomUUID(),
          requestedWorkflowId: "wf-unaccepted",
          workflowType: "scoutMatchProcessingV2Workflow",
          requestedBy: null,
          requestSource: "test",
          inputPayload: JSON.stringify({
            kind: "scoutMatchProcessingV2Workflow",
            version: 1,
            data: {},
          }),
          requestedAt,
        },
        {
          // Accepted, and older. Acceptance is the residual the read filters
          // on, so an accepted start must not be able to set the age.
          requestId: crypto.randomUUID(),
          requestedWorkflowId: "wf-accepted",
          workflowType: "scoutMatchProcessingV2Workflow",
          requestedBy: null,
          requestSource: "test",
          inputPayload: JSON.stringify({
            kind: "scoutMatchProcessingV2Workflow",
            version: 1,
            data: {},
          }),
          requestedAt: new Date(NOW - 12 * HOUR_MS),
          acceptedAt: new Date(NOW - 11 * HOUR_MS),
        },
      ],
    });

    await collectDurablePipelineMetrics(prisma);

    const age = await gaugeValue(scoutDurableBacklogOldestAge, {
      family: "unaccepted-workflow-starts",
    });
    expect(age).toBeGreaterThan(1.5 * 3600);
    expect(age).toBeLessThan(2.5 * 3600);
  });

  test("runs the stalled-match anti-join and reports an empty family as zero", async () => {
    // This family's read is raw SQL across three tables. Seeding a genuinely
    // stalled V2 match needs an observation and its tracked accounts, which is
    // the per-match core's own test territory — what matters here is that the
    // query PARSES AND EXECUTES against the real schema rather than throwing
    // into the catch and leaving -1 behind.
    await collectDurablePipelineMetrics(prisma);

    expect(
      await gaugeValue(scoutDurableBacklogOldestAge, {
        family: "stalled-match-processing",
      }),
    ).toBe(0);
  });

  test("ages the oldest ready intent by when it was minted", async () => {
    // seedIntent stamps createdAt an hour ago. A pending intent beside it is
    // not ready and must not set the age.
    await seedIntent("ready", `${MATCH_ID}:ready`);
    await seedIntent("pending", `${MATCH_ID}:pending`);

    await collectDurablePipelineMetrics(prisma);

    const age = await gaugeValue(scoutDurableBacklogOldestAge, {
      family: "ready-notification-intents",
    });
    expect(age).toBeGreaterThan(0.9 * 3600);
    expect(age).toBeLessThan(1.1 * 3600);
  });

  test("publishes the observation lag as both statistics, zero when nothing was observed", async () => {
    await collectDurablePipelineMetrics(prisma);
    expect(
      await gaugeValue(scoutDurableObservationLag, { statistic: "p90" }),
    ).toBe(0);

    const observedAt = new Date(NOW - 10 * 60 * 1000);
    await prisma.matchObservation.create({
      data: {
        riotMatchId: "NA1_9150",
        platformRoute: "NA1",
        processingPolicy: "FULL",
        deliveryMode: "live",
        pipelineOwner: "TEMPORAL_V2",
        gameCreatedAt: new Date(observedAt.getTime() - 3 * HOUR_MS),
        observedAt,
      },
    });
    await collectDurablePipelineMetrics(prisma);
    for (const statistic of ["p90", "max"]) {
      expect(
        await gaugeValue(scoutDurableObservationLag, { statistic }),
      ).toBeCloseTo(3 * 3600, 3);
    }
  });

  test("a failing read writes the sentinel shape instead of failing the scrape", async () => {
    // A disconnected client stands in for any read that throws. The contract
    // under test is the degraded shape the alerts are written against: ages go
    // to -1, which cannot be mistaken for an age, and the distribution gauges
    // are cleared so `ScoutDurableSweepMissing` sees absence rather than a
    // fabricated zero. The scrape itself must survive.
    await seedIntent("pending", `${MATCH_ID}:a`);
    await collectDurablePipelineMetrics(prisma);
    expect(
      await gaugeValue(scoutDurableNotificationIntents, { state: "pending" }),
    ).toBe(1);

    // A real database missing the table it is about to read, rather than a
    // hand-built stub: a fake client would need a type assertion to pass as a
    // `Db`, and it would only prove the catch block runs when something we
    // wrote throws. This proves it runs when PRISMA throws.
    const degraded = createTestDatabase("durable-pipeline-metrics-degraded");
    try {
      await degraded.prisma.$executeRawUnsafe(
        'DROP TABLE "MatchNotificationIntent"',
      );

      await expect(
        collectDurablePipelineMetrics(degraded.prisma),
      ).resolves.toBeUndefined();
    } finally {
      await dropTestDatabase(degraded.prisma, degraded.dbPath);
    }

    expect(
      await gaugeValue(scoutDurableBacklogOldestAge, {
        family: "live-recovery-batches",
      }),
    ).toBe(-1);
    expect(
      await gaugeValue(scoutDurableBacklogOldestAge, {
        family: "ready-notification-intents",
      }),
    ).toBe(-1);
    // The lag is an age too, so it takes the sentinel rather than going
    // absent; ScoutDurableSweepFailing watches for exactly this.
    expect(
      await gaugeValue(scoutDurableObservationLag, { statistic: "p90" }),
    ).toBe(-1);
    expect(
      await gaugeValue(scoutDurableNotificationIntents, { state: "pending" }),
    ).toBeUndefined();
  });
});
