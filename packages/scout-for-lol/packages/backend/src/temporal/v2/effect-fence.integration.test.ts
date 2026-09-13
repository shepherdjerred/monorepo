import { afterAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { getScoutEffectClaim } from "#src/temporal/effect-claims.ts";
import { runGuardedEffectV2 } from "#src/temporal/v2/effect-fence.ts";

const { prisma } = createTestDatabase("scout-v2-effect-fence");

afterAll(async () => {
  await prisma.$disconnect();
});

const applied = { fact: { outcome: "applied" } as const, effects: 3 };

describe("the V2 effect fence", () => {
  test("applies once and reports the guard and the fact apart", async () => {
    let runs = 0;
    const result = await runGuardedEffectV2(
      {
        key: "fence:first",
        kind: "v2-test",
        apply: () => {
          runs += 1;
          return Promise.resolve(applied);
        },
      },
      prisma,
    );

    expect(result).toEqual({
      guard: { outcome: "applied" },
      fact: { outcome: "applied" },
      effects: 3,
    });
    expect(runs).toBe(1);
    const claim = await getScoutEffectClaim("fence:first", prisma);
    expect(claim?.state).toBe("COMPLETED");
  });

  test("skips an effect a previous attempt already completed", async () => {
    let runs = 0;
    const run = async () =>
      await runGuardedEffectV2(
        {
          key: "fence:completed",
          kind: "v2-test",
          apply: () => {
            runs += 1;
            return Promise.resolve(applied);
          },
        },
        prisma,
      );

    await run();
    expect(await run()).toEqual({
      guard: { outcome: "already-applied" },
      fact: { outcome: "already-applied" },
      effects: 0,
    });
    expect(runs).toBe(1);
  });

  test("never lets two live attempts apply the same effect", async () => {
    // The hole the fence closes: a start-to-close retry fires while the first
    // attempt is STILL RUNNING, so both read the same CLAIMED row and
    // `claimScoutEffect` answers `execute` to both. Without the advisory lock
    // the effect is applied twice; with it, the second attempt waits and then
    // observes COMPLETED.
    let concurrent = 0;
    let overlapped = false;
    const applications: string[] = [];
    const firstEntered = Promise.withResolvers<undefined>();

    const attempt = async (name: string) =>
      await runGuardedEffectV2(
        {
          key: "fence:concurrent",
          kind: "v2-test",
          apply: async () => {
            concurrent += 1;
            if (concurrent > 1) overlapped = true;
            applications.push(name);
            if (name === "first") {
              firstEntered.resolve(undefined);
              // Hold the critical section open long enough that a second
              // attempt starting now would race if nothing fenced it.
              await new Promise((done) => setTimeout(done, 300));
            }
            concurrent -= 1;
            return applied;
          },
        },
        prisma,
      );

    const first = attempt("first");
    await firstEntered.promise;
    const second = await (async () => {
      const pending = attempt("second");
      await first;
      return await pending;
    })();

    expect(applications).toEqual(["first"]);
    expect(overlapped).toBe(false);
    expect(second).toEqual({
      guard: { outcome: "already-applied" },
      fact: { outcome: "already-applied" },
      effects: 0,
    });
  }, 30_000);

  test("takes over a claim whose holder died", async () => {
    // CLAIMED *under the lock* means the holder cannot still be running, so
    // taking it over is safe rather than a guess.
    let runs = 0;
    const key = "fence:dead-holder";
    await expect(
      runGuardedEffectV2(
        {
          key,
          kind: "v2-test",
          apply: () => {
            runs += 1;
            throw new Error("worker died mid-effect");
          },
        },
        prisma,
      ),
    ).rejects.toThrow("worker died mid-effect");
    const abandoned = await getScoutEffectClaim(key, prisma);
    expect(abandoned?.state).toBe("AMBIGUOUS_OR_FAILED");

    const recovered = await runGuardedEffectV2(
      {
        key,
        kind: "v2-test",
        apply: () => {
          runs += 1;
          return Promise.resolve(applied);
        },
      },
      prisma,
    );

    expect(runs).toBe(2);
    // The guard names the reconcile: a claim existed, so this is not a first
    // application even though this run is the one that applied the effect.
    expect(recovered).toEqual({
      guard: { outcome: "already-applied" },
      fact: { outcome: "applied" },
      effects: 3,
    });
  });

  test("fails the Activity on a conflicting fact and leaves the claim open", async () => {
    // Completing the claim here would let the Workflow write its stage
    // receipt, advance the cursor and bury the disagreement permanently.
    const key = "fence:conflict";
    await expect(
      runGuardedEffectV2(
        {
          key,
          kind: "v2-test",
          apply: () =>
            Promise.resolve({
              fact: {
                outcome: "conflict" as const,
                reason: "receipt-evidence-mismatch" as const,
              },
              effects: 1,
            }),
        },
        prisma,
      ),
    ).rejects.toThrow("refusing to complete the claim");

    const claim = await getScoutEffectClaim(key, prisma);
    expect(claim).not.toBeNull();
    expect(claim?.state).not.toBe("COMPLETED");
    expect(claim?.state).toBe("AMBIGUOUS_OR_FAILED");
  });
});
