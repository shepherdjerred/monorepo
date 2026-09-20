import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  ArtifactDescriptorSchema,
  type ArtifactDescriptor,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import {
  IsoInstantSchema,
  RecoveryBatchIdSchema,
  RiotMatchIdSchema,
  type RecoveryBatchId,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { ScoutStageSchema } from "@scout-for-lol/temporal/contracts";
import {
  SCOUT_V2_PAGE_MAX,
  type ScoutRecoveryBatchRefV2,
} from "@scout-for-lol/temporal/contracts-v2";
import type {
  ScoutRecoveryProcessV2Result,
  ScoutRecoveryScanV2Result,
  ScoutRecoveryTransitionV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  createRecoveryBatch,
  getRecoveryBatch,
} from "#src/database/durable/recovery-repository.ts";
import {
  matchRecoveryBatchRowToRecord,
  type MatchRecoveryBatchRecord,
} from "#src/database/durable/recovery-row.ts";
import { recoveryScanToken } from "#src/database/durable/recovery-scan.ts";
import {
  getObservation,
  observeMatch,
} from "#src/database/durable/observation-repository.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import {
  isoInstantFromEpochMs,
  platformRouteOf,
} from "#src/durable/match/match-identity.ts";

/**
 * A V2 recovery batch driven over real receipt, observation and batch rows.
 *
 * Riot is the one thing that cannot be real here. `processRecoveryPageV2`
 * resolves each item's match context because an observation needs the game's
 * creation instant, and only the authoritative MatchV5 payload carries it — so
 * exactly that module is replaced and nothing else is. Every durable read and
 * write below, including the anti-joins the scan and the processing page are
 * built on, runs against Postgres.
 */
const riot = vi.hoisted(() => ({
  gameCreation: Date.parse("2026-09-10T09:00:00.000Z"),
}));

vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2MatchContext: (riotMatchId: string) =>
    Promise.resolve({
      matchId: riotMatchId,
      riotMatchId,
      matchData: { info: { gameCreation: riot.gameCreation } },
      trackedPlayers: [],
    }),
}));

/**
 * The Activities read the module-level Prisma singleton, so the singleton is
 * pointed at this file's own database rather than replaced: the database module
 * reads `DATABASE_URL` when it is first imported and the pg pool connects
 * lazily, so setting it before that first import gives the production client an
 * isolated, migrated database to work against.
 */
const testDatabase = createTestDatabase("temporal-v2-recovery");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;

const { prisma: activityPrisma } = await import("#src/database/index.ts");
const {
  buildReceipt,
  rawArchiveEvidenceCodec,
  rawArchiveEvidenceOf,
  rawArchiveReceiptKind,
} = await import("#src/report-lake/durable-receipts.ts");
const {
  closeRecoveryBatchV2,
  digestRecoveryBatchV2,
  processRecoveryPageV2,
  readRecoveryBatchV2,
  scanRecoveryPageV2,
} = await import("#src/temporal/v2/recovery.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const STAGE = ScoutStageSchema.parse("dev");

/**
 * Every batch below is bounded by its own `createdAt`, and that bound is an
 * upper bound over one shared receipt table — so the windows are laid out so no
 * group's batch can see another group's archive range. The processing group
 * sits earliest and its own bound excludes everything later; the bound and
 * paging groups sit above it and see its matches only once they are observed,
 * which is the state the processing group leaves them in.
 */
const TIMELINE_BASE = Date.parse("2026-09-10T00:00:00.000Z");
function at(minutes: number): Date {
  return new Date(TIMELINE_BASE + minutes * 60_000);
}

const LIVE_GAME_CREATED_AT = IsoInstantSchema.parse("2026-09-09T20:00:00.000Z");
const LIVE_OBSERVED_AT = IsoInstantSchema.parse("2026-09-09T20:05:00.000Z");

const PROCESS_ID_BASE = 820_000;
const BOUND_ID_BASE = 830_000;
const PAGE_ID_BASE = 840_000;

function matchId(suffix: number): RiotMatchId {
  return RiotMatchIdSchema.parse(`NA1_${String(suffix)}`);
}

function batchRef(recoveryBatchId: RecoveryBatchId): ScoutRecoveryBatchRefV2 {
  return { stage: STAGE, recoveryBatchId };
}

/**
 * The artifact identity a `raw-archive-match` receipt attests to. The recovery
 * page stamps the observation from exactly this evidence, so each match gets a
 * distinguishable one rather than a shared placeholder.
 */
function descriptorFor(riotMatchId: RiotMatchId): ArtifactDescriptor {
  const gameId = riotMatchId.split("_")[1] ?? "0";
  return ArtifactDescriptorSchema.parse({
    kind: "match",
    key: `games/2026/09/10/${riotMatchId}/match.json`,
    digest: gameId.padStart(64, "a"),
    bytes: 2048,
    contentType: "application/json",
    capturedAt: "2026-09-10T09:05:00.000Z",
  });
}

async function seedArchiveReceipt(
  riotMatchId: RiotMatchId,
  recordedAt: Date,
): Promise<ArtifactDescriptor> {
  const descriptor = descriptorFor(riotMatchId);
  expect(
    await recordReceipt(
      prisma,
      buildReceipt({
        matchId: riotMatchId,
        kind: rawArchiveReceiptKind("match"),
        evidence: rawArchiveEvidenceCodec.serialize(
          rawArchiveEvidenceOf(descriptor),
        ),
        recordedAt,
      }),
    ),
  ).toEqual({ outcome: "applied" });
  return descriptor;
}

/** An observation the live pipeline committed: FULL, and v1's to finish. */
async function seedLiveObservation(riotMatchId: RiotMatchId): Promise<void> {
  expect(
    await observeMatch(prisma, {
      matchId: riotMatchId,
      platformRoute: platformRouteOf(riotMatchId),
      policy: "FULL",
      owner: { kind: "legacy-v1" },
      promotion: null,
      gameCreatedAt: LIVE_GAME_CREATED_AT,
      observedAt: LIVE_OBSERVED_AT,
      deliveryMode: "live",
      artifacts: { match: null, timeline: null },
    }),
  ).toEqual({ outcome: "applied" });
}

function batchRecord(id: string, createdAt: Date): MatchRecoveryBatchRecord {
  return matchRecoveryBatchRowToRecord({
    recoveryBatchId: id,
    policy: "normal",
    state: "planned",
    cursorPosition: null,
    pagesScanned: null,
    pageBudget: null,
    discoveredCount: null,
    succeededCount: null,
    suppressedCount: null,
    failedCount: null,
    abandonReason: null,
    workflowId: null,
    createdAt,
  });
}

async function seedBatch(
  id: string,
  createdAt: Date,
): Promise<RecoveryBatchId> {
  expect(await createRecoveryBatch(prisma, batchRecord(id, createdAt))).toEqual(
    {
      outcome: "applied",
    },
  );
  return RecoveryBatchIdSchema.parse(id);
}

describe("readRecoveryBatchV2", () => {
  test("answers absent for an id nothing created, and the row for one that exists", async () => {
    // `absent` is a legitimate answer here and only here: this is what a
    // Workflow calls before it knows whether its batch was ever created.
    expect(
      await readRecoveryBatchV2(
        batchRef(RecoveryBatchIdSchema.parse("rb-never-created")),
      ),
    ).toEqual({ kind: "absent" });

    const recoveryBatchId = await seedBatch("rb-read", at(2));
    expect(await readRecoveryBatchV2(batchRef(recoveryBatchId))).toEqual({
      kind: "present",
      policy: "normal",
      state: { kind: "planned" },
    });
  });
});

describe("recovering a batch's gap", () => {
  const MATCH_COUNT = 12;
  /** The match the live pipeline reaches between the two processing pages. */
  const OVERTAKEN_INDEX = 11;

  const descriptors = new Map<RiotMatchId, ArtifactDescriptor>();
  let recoveryBatchId: RecoveryBatchId;
  let scan: ScoutRecoveryScanV2Result;
  /** The row as the scan left it, read before the batch was driven onwards. */
  let scannedBatch: MatchRecoveryBatchRecord | null;
  let firstPage: ScoutRecoveryProcessV2Result;
  let secondPage: ScoutRecoveryProcessV2Result;
  let digested: ScoutRecoveryTransitionV2Result;
  let closed: ScoutRecoveryTransitionV2Result;

  function processMatchId(index: number): RiotMatchId {
    return matchId(PROCESS_ID_BASE + index);
  }

  beforeAll(async () => {
    const seeded = await Promise.all(
      Array.from({ length: MATCH_COUNT }, async (_unused, offset) => {
        const index = offset + 1;
        const id = processMatchId(index);
        return [id, await seedArchiveReceipt(id, at(index))] as const;
      }),
    );
    for (const [id, descriptor] of seeded) {
      descriptors.set(id, descriptor);
    }

    recoveryBatchId = await seedBatch("rb-process", at(20));
    scan = await scanRecoveryPageV2(batchRef(recoveryBatchId));
    scannedBatch = await getRecoveryBatch(prisma, { recoveryBatchId });
    firstPage = await processRecoveryPageV2(batchRef(recoveryBatchId));
    // The live pipeline observes one of the matches still in the gap, between
    // the page that counted it and the page that would have recovered it.
    await seedLiveObservation(processMatchId(OVERTAKEN_INDEX));
    secondPage = await processRecoveryPageV2(batchRef(recoveryBatchId));
    digested = await digestRecoveryBatchV2(batchRef(recoveryBatchId));
    closed = await closeRecoveryBatchV2({
      ...batchRef(recoveryBatchId),
      close: { outcome: "complete" },
    });
  });

  test("the scan opens the batch and surveys its whole archive range", () => {
    expect(scan.commit).toEqual({ outcome: "applied" });
    expect(scan.discovered).toBe(MATCH_COUNT);
    expect(scan.complete).toBe(true);
    expect(scannedBatch?.batch.state).toMatchObject({
      kind: "scanning",
      cursor: { pagesScanned: 1 },
    });
  });

  test("the first page recovers a page's worth and freezes the discovered count", () => {
    // `discovered` is issued once, on the scanning batch, and never recounted:
    // the range shrinks as the live pipeline observes matches in it, so a
    // recount would move the target the tally is chasing.
    expect(firstPage.commit).toEqual({ outcome: "applied" });
    expect(firstPage.counts).toEqual({
      discovered: MATCH_COUNT,
      succeeded: 10,
      suppressed: 0,
      failed: 0,
    });
    expect(firstPage.complete).toBe(false);
  });

  test("a recovered match is observed ARCHIVE_ONLY, owned by the V2 pipeline", async () => {
    // The policy is the whole design: a batch replaying a week-old outage
    // captures the FACT that the match exists and runs no downstream effect, so
    // it can never announce a week-old game. The owner is what stops two
    // pipelines both deciding they are settling it.
    const riotMatchId = processMatchId(1);
    const stored = await getObservation(prisma, { matchId: riotMatchId });
    expect(stored?.policy).toBe("ARCHIVE_ONLY");
    expect(stored?.owner).toEqual({ kind: "temporal-v2" });
    expect(stored?.promotion).toBeNull();

    // Stamped from the receipt's own evidence rather than reconstructed from
    // the layout convention, which would be evidence of nothing.
    const descriptor = descriptors.get(riotMatchId);
    expect(stored?.artifacts.match).toEqual({
      key: descriptor?.key,
      digest: descriptor?.digest,
    });
    expect(stored?.gameCreatedAt).toBe(
      isoInstantFromEpochMs(riot.gameCreation),
    );
  });

  test("every match in the range ends observed exactly once", async () => {
    const observations = await Promise.all(
      Array.from({ length: MATCH_COUNT }, (_unused, offset) =>
        getObservation(prisma, { matchId: processMatchId(offset + 1) }),
      ),
    );
    expect(observations.every((observation) => observation !== null)).toBe(
      true,
    );
  });

  test("a match the live pipeline reached first is suppressed, not overwritten", async () => {
    // The shortfall between `discovered` and the items this batch handled
    // belongs to `suppressed`: those are matches the batch counted and somebody
    // else handled. Calling them failures would invent failures that never
    // happened; leaving them unattributed would strand the batch one transition
    // short of its digest forever.
    expect(secondPage.counts).toEqual({
      discovered: MATCH_COUNT,
      succeeded: 11,
      suppressed: 1,
      failed: 0,
    });
    expect(secondPage.complete).toBe(true);

    const overtaken = await getObservation(prisma, {
      matchId: processMatchId(OVERTAKEN_INDEX),
    });
    expect(overtaken?.policy).toBe("FULL");
    expect(overtaken?.owner).toEqual({ kind: "legacy-v1" });
    expect(overtaken?.observedAt).toBe(LIVE_OBSERVED_AT);
  });

  test("the tally adds up, so the digest is not refused as items-unaccounted", async () => {
    // `beginDigest` refuses while the three outcomes are short of `discovered`,
    // which is the guard that stops a batch being reported as recovered when
    // part of its range was never looked at. Reaching `digesting` is the proof
    // that the suppressed shortfall was attributed rather than lost.
    expect(digested.commit).toEqual({ outcome: "applied" });
    expect(digested.state).toEqual({ kind: "digesting" });
    expect(closed.commit).toEqual({ outcome: "applied" });
    expect(closed.state).toEqual({ kind: "complete" });

    const stored = await getRecoveryBatch(prisma, { recoveryBatchId });
    expect(stored?.batch.state).toEqual({ kind: "complete" });
  });
});

describe("the batch's archive bound", () => {
  const INSIDE_FIRST = matchId(BOUND_ID_BASE + 1);
  const INSIDE_SECOND = matchId(BOUND_ID_BASE + 2);
  const ARCHIVED_AFTER = matchId(BOUND_ID_BASE + 3);
  const LAST_INSIDE_AT = at(31);

  test("a match archived after the batch was created is never discovered", async () => {
    // The upper bound is what makes a batch a fixed unit of work: a match
    // archived after it belongs to the live pipeline, which is still running
    // and still owns it. Because receipts are append-only that bound cannot
    // move, which is what makes `discovered` stable across the scan's pages.
    await seedArchiveReceipt(INSIDE_FIRST, at(30));
    await seedArchiveReceipt(INSIDE_SECOND, LAST_INSIDE_AT);
    await seedArchiveReceipt(ARCHIVED_AFTER, at(40));
    const recoveryBatchId = await seedBatch("rb-bound", at(35));

    const scanned = await scanRecoveryPageV2(batchRef(recoveryBatchId));
    expect(scanned.commit).toEqual({ outcome: "applied" });
    expect(scanned.discovered).toBe(2);
    expect(scanned.complete).toBe(true);

    // The cursor stopped on the last receipt under the bound. Had the scan
    // walked past it the position would name the later archive instead, and
    // `discovered` would have counted work this batch does not own.
    const stored = await getRecoveryBatch(prisma, { recoveryBatchId });
    expect(stored?.batch.state).toEqual({
      kind: "scanning",
      cursor: {
        position: recoveryScanToken({
          recordedAt: LAST_INSIDE_AT,
          riotMatchId: INSIDE_SECOND,
        }),
        pagesScanned: 1,
        pageBudget: 50,
      },
    });

    // The continuation page holds the bound too: the later archive is still
    // out of range, so the scan has nothing left and commits nothing.
    const resumed = await scanRecoveryPageV2(batchRef(recoveryBatchId));
    expect(resumed).toEqual({
      commit: { outcome: "already-applied" },
      state: stored?.batch.state,
      discovered: 0,
      complete: true,
    });
  });
});

describe("paging a scan over a range larger than one page", () => {
  test("each page advances the cursor, and the scan completes when exhausted", async () => {
    // A page that comes back full means the range outran it, so the scan is not
    // complete — the cursor is what the next page resumes from, and it has to
    // move exactly once per page or the batch either re-reads a stretch of the
    // range or skips one.
    const overflowing = SCOUT_V2_PAGE_MAX + 1;
    await Promise.all(
      Array.from({ length: overflowing }, (_unused, offset) =>
        seedArchiveReceipt(matchId(PAGE_ID_BASE + offset), at(50)),
      ),
    );
    const recoveryBatchId = await seedBatch("rb-pages", at(60));

    const firstPage = await scanRecoveryPageV2(batchRef(recoveryBatchId));
    expect(firstPage.commit).toEqual({ outcome: "applied" });
    expect(firstPage.complete).toBe(false);
    const afterFirst = await getRecoveryBatch(prisma, { recoveryBatchId });
    expect(afterFirst?.batch.state).toMatchObject({
      kind: "scanning",
      cursor: { pagesScanned: 1 },
    });

    const secondPage = await scanRecoveryPageV2(batchRef(recoveryBatchId));
    expect(secondPage.commit).toEqual({ outcome: "applied" });
    expect(secondPage.complete).toBe(true);
    const afterSecond = await getRecoveryBatch(prisma, { recoveryBatchId });
    expect(afterSecond?.batch.state).toMatchObject({
      kind: "scanning",
      cursor: { pagesScanned: 2 },
    });
  });
});

describe("closeRecoveryBatchV2", () => {
  test("abandonment carries the reason into the row", async () => {
    // The reason is the only record that survives the run, and it is the
    // difference between a batch that needs a successor and one that must not
    // have one.
    const recoveryBatchId = await seedBatch("rb-abandon", at(3));

    const abandoned = await closeRecoveryBatchV2({
      ...batchRef(recoveryBatchId),
      close: { outcome: "abandoned", reason: "operator-cancelled" },
    });
    expect(abandoned).toEqual({
      commit: { outcome: "applied" },
      state: { kind: "abandoned", reason: "operator-cancelled" },
    });

    const stored = await getRecoveryBatch(prisma, { recoveryBatchId });
    expect(stored?.batch.state).toEqual({
      kind: "abandoned",
      reason: "operator-cancelled",
    });
  });
});
