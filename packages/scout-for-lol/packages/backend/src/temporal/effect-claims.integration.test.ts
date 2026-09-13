import { afterAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  claimScoutEffect,
  completeScoutEffect,
  getScoutEffectClaim,
  recordScoutEffectFailure,
} from "#src/temporal/effect-claims.ts";

const { prisma } = createTestDatabase("scout-effect-claims");

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getScoutEffectClaim", () => {
  test("is null before anything claims the key", async () => {
    expect(await getScoutEffectClaim("guard:absent", prisma)).toBeNull();
  });

  test("separates a first claim from a retry of an unfinished one", async () => {
    const key = "guard:unfinished";
    // The distinction a guarded V2 Activity reports: `claimScoutEffect`
    // answers `execute` for both a first claim and a retry of one a previous
    // attempt left unfinished, so the guard's `applied` versus
    // `already-applied` has to come from reading the claim first.
    expect(await getScoutEffectClaim(key, prisma)).toBeNull();
    expect(await claimScoutEffect({ key, kind: "v2-test" }, prisma)).toBe(
      "execute",
    );

    expect(await getScoutEffectClaim(key, prisma)).toEqual({
      key,
      kind: "v2-test",
      state: "CLAIMED",
      resultId: null,
    });
    expect(await claimScoutEffect({ key, kind: "v2-test" }, prisma)).toBe(
      "execute",
    );
  });

  test("reports a completed effect and a failed one apart", async () => {
    const completed = "guard:completed";
    await claimScoutEffect({ key: completed, kind: "v2-test" }, prisma);
    await completeScoutEffect(completed, prisma);
    const completedClaim = await getScoutEffectClaim(completed, prisma);
    expect(completedClaim?.state).toBe("COMPLETED");

    const failed = "guard:failed";
    await claimScoutEffect({ key: failed, kind: "v2-test" }, prisma);
    await recordScoutEffectFailure(failed, new Error("boom"), prisma);
    const failedClaim = await getScoutEffectClaim(failed, prisma);
    expect(failedClaim?.state).toBe("AMBIGUOUS_OR_FAILED");
    // An ambiguous claim still permits execution: the effect's own state gate
    // decides what is left to do, and the fact's outcome is what says whether
    // anything was applied twice.
    expect(
      await claimScoutEffect({ key: failed, kind: "v2-test" }, prisma),
    ).toBe("execute");
  });
});
