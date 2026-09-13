import { afterAll, describe, expect, test, vi } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { MatchProcessingPolicy } from "@scout-for-lol/domain/match-processing/states.ts";
import type * as DatabaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("scout-v2-observation-conflict");

// The reconciliation reads and writes through the process client; the module
// under test imports it directly, as every V2 Activity does.
vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const { observeMatch, getObservation } =
  await import("#src/database/durable/observation-repository.ts");
const { reconcileObservationConflictV2 } =
  await import("#src/temporal/v2/match-archive.ts");

afterAll(async () => {
  await prisma.$disconnect();
});

const CREATED_AT = IsoInstantSchema.parse("2026-09-13T09:00:00.000Z");
const OBSERVED_AT = IsoInstantSchema.parse("2026-09-13T10:00:00.000Z");

async function seedObservation(
  matchId: RiotMatchId,
  policy: MatchProcessingPolicy,
  owner: "legacy-v1" | "temporal-v2",
): Promise<void> {
  await observeMatch(prisma, {
    matchId,
    platformRoute: "NA1",
    policy,
    owner: { kind: owner },
    promotion: null,
    gameCreatedAt: CREATED_AT,
    observedAt: OBSERVED_AT,
    artifacts: { match: null, timeline: null },
  });
}

describe("reconciling a V2 observation conflict", () => {
  test("leaves an ownership conflict for the Workflow to act on", async () => {
    // The expected no-op: another pipeline holds the match, and the Workflow
    // reads the stored owner and stops before any effect.
    const matchId = RiotMatchIdSchema.parse("NA1_6001");
    await seedObservation(matchId, "FULL", "legacy-v1");

    expect(
      await reconcileObservationConflictV2(
        matchId,
        "ownership-held-by-another-owner",
      ),
    ).toEqual({
      outcome: "conflict",
      reason: "ownership-held-by-another-owner",
    });
    const stored = await getObservation(prisma, { matchId });
    expect(stored?.policy).toBe("FULL");
    expect(stored?.owner).toEqual({ kind: "legacy-v1" });
  });

  test("promotes this pipeline's own archive-only observation to FULL", async () => {
    // A capture path observed the match without downstream effects;
    // post-match discovery has now surfaced it as work. This is the domain's
    // archive-only-promotes-at-most-once transition, not drift — and without
    // it the Workflow would skip settlement and progression on a stale policy,
    // attest the stage receipt and advance the cursor anyway.
    const matchId = RiotMatchIdSchema.parse("NA1_6002");
    await seedObservation(matchId, "ARCHIVE_ONLY", "temporal-v2");

    expect(
      await reconcileObservationConflictV2(matchId, "observation-differs"),
    ).toEqual({ outcome: "applied" });

    const promoted = await getObservation(prisma, { matchId });
    expect(promoted?.policy).toBe("FULL");
    expect(promoted?.promotion).not.toBeNull();
  });

  test("promotes at most once", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_6003");
    await seedObservation(matchId, "ARCHIVE_ONLY", "temporal-v2");

    await reconcileObservationConflictV2(matchId, "observation-differs");
    expect(
      await reconcileObservationConflictV2(matchId, "observation-differs"),
    ).toEqual({ outcome: "already-applied" });
  });

  test.each([
    {
      name: "a row that already stands as FULL",
      matchId: "NA1_6004",
      seed: async (id: RiotMatchId) => {
        await seedObservation(id, "FULL", "temporal-v2");
      },
    },
    {
      name: "an archive-only row another pipeline owns",
      matchId: "NA1_6005",
      seed: async (id: RiotMatchId) => {
        await seedObservation(id, "ARCHIVE_ONLY", "legacy-v1");
      },
    },
    {
      name: "a match with no observation at all",
      matchId: "NA1_6006",
      seed: async () => {
        // Nothing seeded on purpose.
      },
    },
  ])("fails the Activity for $name", async (scenario) => {
    // Any other disagreement is two producers differing about the facts of a
    // match, which no transition can reconcile. Continuing from the stored row
    // would suppress the drift permanently behind a stage receipt.
    const matchId = RiotMatchIdSchema.parse(scenario.matchId);
    await scenario.seed(matchId);

    await expect(
      reconcileObservationConflictV2(matchId, "observation-differs"),
    ).rejects.toThrow("Cannot reconcile the observation");
  });
});
