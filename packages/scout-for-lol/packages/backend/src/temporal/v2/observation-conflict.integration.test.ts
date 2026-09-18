import { afterAll, describe, expect, test, vi } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  S3ObjectKeySchema,
  Sha256DigestSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { MatchProcessingPolicy } from "@scout-for-lol/domain/match-processing/states.ts";
import type { MatchObservationRecord } from "#src/database/durable/observation-row.ts";
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
const OTHER_CREATED_AT = IsoInstantSchema.parse("2026-09-13T07:30:00.000Z");
const OBSERVED_AT = IsoInstantSchema.parse("2026-09-13T10:00:00.000Z");

function artifact(key: string, digestFill: string) {
  return {
    key: S3ObjectKeySchema.parse(key),
    digest: Sha256DigestSchema.parse(digestFill.repeat(64)),
  };
}
const ARTIFACT_A = artifact("games/2026/09/13/NA1_6008/match.json", "a");
const ARTIFACT_B = artifact("games/2026/09/13/NA1_6008/match.json", "b");

function observationOf(
  matchId: RiotMatchId,
  overrides: Partial<MatchObservationRecord> = {},
): MatchObservationRecord {
  return {
    matchId,
    platformRoute: "NA1",
    policy: "FULL",
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: CREATED_AT,
    observedAt: OBSERVED_AT,
    artifacts: { match: null, timeline: null },
    ...overrides,
  };
}

async function seedObservation(
  matchId: RiotMatchId,
  policy: MatchProcessingPolicy,
  owner: "legacy-v1" | "temporal-v2",
  overrides: Partial<MatchObservationRecord> = {},
): Promise<void> {
  await observeMatch(
    prisma,
    observationOf(matchId, { policy, owner: { kind: owner }, ...overrides }),
  );
}

describe("reconciling a V2 observation conflict", () => {
  test("leaves an ownership conflict for the Workflow to act on", async () => {
    // The expected no-op: another pipeline holds the match, and the Workflow
    // reads the stored owner and stops before any effect.
    const matchId = RiotMatchIdSchema.parse("NA1_6001");
    await seedObservation(matchId, "FULL", "legacy-v1");

    expect(
      await reconcileObservationConflictV2(
        observationOf(matchId),
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
      await reconcileObservationConflictV2(
        observationOf(matchId),
        "observation-differs",
      ),
    ).toEqual({ outcome: "applied" });

    const promoted = await getObservation(prisma, { matchId });
    expect(promoted?.policy).toBe("FULL");
    expect(promoted?.promotion).not.toBeNull();
  });

  test("promotes at most once", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_6003");
    await seedObservation(matchId, "ARCHIVE_ONLY", "temporal-v2");

    await reconcileObservationConflictV2(
      observationOf(matchId),
      "observation-differs",
    );
    expect(
      await reconcileObservationConflictV2(
        observationOf(matchId),
        "observation-differs",
      ),
    ).toEqual({ outcome: "already-applied" });
  });

  test("refuses to promote when the facts differ as well as the policy", async () => {
    // A promotion moves ARCHIVE_ONLY to FULL and nothing else, so it is the
    // right transition only when the policy is the sole disagreement.
    // Promoting here would launder real drift into a FULL row and let
    // settlement, the receipts and the cursor proceed over facts two producers
    // never agreed on.
    const matchId = RiotMatchIdSchema.parse("NA1_6007");
    await seedObservation(matchId, "ARCHIVE_ONLY", "temporal-v2");

    await expect(
      reconcileObservationConflictV2(
        observationOf(matchId, { gameCreatedAt: OTHER_CREATED_AT }),
        "observation-differs",
      ),
    ).rejects.toThrow("about the match's own facts");

    const stored = await getObservation(prisma, { matchId });
    expect(stored?.policy).toBe("ARCHIVE_ONLY");
    expect(stored?.promotion).toBeNull();
  });

  test("refuses to promote when the artifacts differ as well as the policy", async () => {
    // The claim leaves the artifact columns out because silence about an
    // artifact is not disagreement. Two DIFFERENT identities are: that is
    // canonical raw-artifact drift, and a promotion that looked only at the
    // claim would launder it into a FULL row.
    const matchId = RiotMatchIdSchema.parse("NA1_6008");
    await seedObservation(matchId, "ARCHIVE_ONLY", "temporal-v2", {
      artifacts: { match: ARTIFACT_A, timeline: null },
    });

    await expect(
      reconcileObservationConflictV2(
        observationOf(matchId, {
          artifacts: { match: ARTIFACT_B, timeline: null },
        }),
        "observation-differs",
      ),
    ).rejects.toThrow("about the match's own facts");

    const stored = await getObservation(prisma, { matchId });
    expect(stored?.policy).toBe("ARCHIVE_ONLY");
    expect(stored?.artifacts.match).toEqual(ARTIFACT_A);
  });

  test("still promotes when the incoming observation is silent about the artifact", async () => {
    // Silence is not disagreement — v1's own rule for the columns. A run that
    // has no descriptor to offer makes no claim about which bytes are
    // canonical, so the stored identity stands and the policy alone differs.
    const matchId = RiotMatchIdSchema.parse("NA1_6009");
    await seedObservation(matchId, "ARCHIVE_ONLY", "temporal-v2", {
      artifacts: { match: ARTIFACT_A, timeline: null },
    });

    expect(
      await reconcileObservationConflictV2(
        observationOf(matchId),
        "observation-differs",
      ),
    ).toEqual({ outcome: "applied" });
    const stored = await getObservation(prisma, { matchId });
    expect(stored?.policy).toBe("FULL");
    expect(stored?.artifacts.match).toEqual(ARTIFACT_A);
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
      reconcileObservationConflictV2(
        observationOf(matchId),
        "observation-differs",
      ),
    ).rejects.toThrow("Cannot reconcile the observation");
  });
});
