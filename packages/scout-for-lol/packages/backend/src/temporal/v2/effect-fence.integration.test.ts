import { afterAll, describe, expect, test } from "vitest";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  claimScoutEffect,
  getScoutEffectClaim,
} from "#src/temporal/effect-claims.ts";
import {
  runGuardedEffectV2,
  type ScoutEffectFenceBudget,
} from "#src/temporal/v2/effect-fence.ts";

const { prisma } = createTestDatabase("scout-v2-effect-fence");

afterAll(async () => {
  await prisma.$disconnect();
});

const applied = { fact: { outcome: "applied" } as const, effects: 3 };

async function sleep(ms: number): Promise<void> {
  await new Promise((done) => setTimeout(done, ms));
}

/** Pass a member through untouched, keeping Prisma's own `this` binding. */
function passThrough(target: object, property: string | symbol): unknown {
  const value = Reflect.get(target, property);
  return typeof value === "function" ? value.bind(target) : value;
}

/** The completion the fence asks for: it lands, and its response does not. */
async function commitThenLoseAck(
  args: Parameters<typeof prisma.scoutEffectClaim.update>[0],
): Promise<never> {
  await prisma.scoutEffectClaim.update(args);
  throw new Error("connection reset before the completion was acked");
}

/**
 * A client whose completion write COMMITS and then loses its acknowledgement.
 *
 * Only `scoutEffectClaim.update` is intercepted — the call
 * `completeScoutEffect` makes. `updateMany`, which the fence's guarded failure
 * recorder uses, runs for real, so the test observes what that guard actually
 * does to a row that is already COMPLETED.
 */
function clientWhoseCompletionAckIsLost(): ExtendedPrismaClient {
  return new Proxy(prisma, {
    get(target, property) {
      if (property !== "scoutEffectClaim") return passThrough(target, property);
      return new Proxy(target.scoutEffectClaim, {
        get(delegate, call) {
          if (call !== "update") return passThrough(delegate, call);
          return commitThenLoseAck;
        },
      });
    },
  });
}

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
      { database: prisma },
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
        { database: prisma },
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
              await sleep(300);
            }
            concurrent -= 1;
            return applied;
          },
        },
        { database: prisma },
      );

    const first = attempt("first");
    await firstEntered.promise;
    const pending = attempt("second");
    await first;
    const second = await pending;

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
        { database: prisma },
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
      { database: prisma },
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
        { database: prisma },
      ),
    ).rejects.toThrow("refusing to complete the claim");

    const claim = await getScoutEffectClaim(key, prisma);
    expect(claim).not.toBeNull();
    expect(claim?.state).not.toBe("COMPLETED");
    expect(claim?.state).toBe("AMBIGUOUS_OR_FAILED");
  });
});

describe("a fence taking over a dead attempt", () => {
  test("completes from the fact that already stands instead of re-applying", async () => {
    // The exact state a worker leaves when it commits its durable fact and
    // dies before completing its claim: a CLAIMED row with a standing
    // receipt. Re-executing there is how two correct rules build a permanent
    // wedge — the state-gated effect finds nothing left to do, records empty
    // evidence, and conflicts with the standing receipt, which the conflict
    // rule then turns into a non-retryable failure forever. The `apply` below
    // returns exactly that conflict, so a fence that re-applied would fail
    // this test the way the pipeline would fail in production.
    const key = "fence:takeover-reconcile";
    let applyRuns = 0;
    await claimScoutEffect({ key, kind: "v2-test" }, prisma);

    const result = await runGuardedEffectV2(
      {
        key,
        kind: "v2-test",
        alreadyApplied: () =>
          Promise.resolve({
            fact: { outcome: "already-applied" as const },
            effects: 7,
          }),
        apply: () => {
          applyRuns += 1;
          return Promise.resolve({
            fact: {
              outcome: "conflict" as const,
              reason: "receipt-evidence-mismatch" as const,
            },
            effects: 0,
          });
        },
      },
      { database: prisma },
    );

    expect(applyRuns).toBe(0);
    expect(result).toEqual({
      guard: { outcome: "already-applied" },
      fact: { outcome: "already-applied" },
      effects: 7,
    });
    const claim = await getScoutEffectClaim(key, prisma);
    expect(claim?.state).toBe("COMPLETED");
  });

  test("still applies when the dead attempt left no durable fact", async () => {
    // The probe must not suppress a legitimate takeover: a holder that died
    // BEFORE committing its fact leaves nothing standing, and the effect has
    // to run.
    const key = "fence:takeover-unfinished";
    let applyRuns = 0;
    await claimScoutEffect({ key, kind: "v2-test" }, prisma);

    const result = await runGuardedEffectV2(
      {
        key,
        kind: "v2-test",
        alreadyApplied: () => Promise.resolve(null),
        apply: () => {
          applyRuns += 1;
          return Promise.resolve(applied);
        },
      },
      { database: prisma },
    );

    expect(applyRuns).toBe(1);
    expect(result).toEqual({
      guard: { outcome: "already-applied" },
      fact: { outcome: "applied" },
      effects: 3,
    });
  });

  test("does not probe on a first claim", async () => {
    // Nothing has run yet, so there is nothing to reconcile with and the probe
    // would be a wasted read on the happy path.
    let probes = 0;
    await runGuardedEffectV2(
      {
        key: "fence:first-claim-no-probe",
        kind: "v2-test",
        alreadyApplied: () => {
          probes += 1;
          return Promise.resolve(null);
        },
        apply: () => Promise.resolve(applied),
      },
      { database: prisma },
    );
    expect(probes).toBe(0);
  });
});

describe("a fence whose lock cannot outlast its effect", () => {
  test("abandons an effect that overruns the deadline, with the lock still held", async () => {
    // The deadline exists so the bookkeeping below happens while the fence is
    // provably still held: the lock lives 10s here and the effect is cut off
    // at 300ms.
    const key = "fence:overrun";
    const budget: ScoutEffectFenceBudget = {
      lockLifetimeMs: 10_000,
      effectDeadlineMs: 300,
    };
    const finished = Promise.withResolvers<undefined>();

    await expect(
      runGuardedEffectV2(
        {
          key,
          kind: "v2-test",
          apply: async () => {
            await sleep(1500);
            finished.resolve(undefined);
            return applied;
          },
        },
        { database: prisma, budget },
      ),
    ).rejects.toThrow("exceeded its 300ms fence deadline");

    const claim = await getScoutEffectClaim(key, prisma);
    expect(claim?.state).toBe("AMBIGUOUS_OR_FAILED");

    // The abandoned effect keeps running — a promise cannot be cancelled — and
    // must not be able to complete the claim behind the fence's back.
    await finished.promise;
    const afterwards = await getScoutEffectClaim(key, prisma);
    expect(afterwards?.state).toBe("AMBIGUOUS_OR_FAILED");
  }, 30_000);

  test("refuses to complete a claim when the fence lapsed mid-effect", async () => {
    // The transaction's own timer expires while the effect is still running,
    // so Prisma rolls back and releases the advisory lock underneath it. The
    // fence must not treat the effect as fenced after that: whether the
    // liveness probe or Prisma's own rejection surfaces first, the attempt
    // fails and the claim is never marked COMPLETED.
    const key = "fence:lapsed";
    const budget: ScoutEffectFenceBudget = {
      lockLifetimeMs: 700,
      effectDeadlineMs: 30_000,
    };
    let runs = 0;

    await expect(
      runGuardedEffectV2(
        {
          key,
          kind: "v2-test",
          apply: async () => {
            runs += 1;
            await sleep(1500);
            return applied;
          },
        },
        { database: prisma, budget },
      ),
    ).rejects.toThrow();

    const claim = await getScoutEffectClaim(key, prisma);
    expect(claim?.state).not.toBe("COMPLETED");

    // Because nothing was completed, the next attempt re-enters under a lock
    // it genuinely holds rather than inheriting a completion nobody can vouch
    // for.
    const recovered = await runGuardedEffectV2(
      {
        key,
        kind: "v2-test",
        apply: () => {
          runs += 1;
          return Promise.resolve(applied);
        },
      },
      { database: prisma },
    );
    expect(runs).toBe(2);
    expect(recovered.fact).toEqual({ outcome: "applied" });
    const completed = await getScoutEffectClaim(key, prisma);
    expect(completed?.state).toBe("COMPLETED");
  }, 30_000);

  test("never downgrades a completed claim when only the ack is lost", async () => {
    // The completion commits and the response is lost. An unguarded failure
    // write would turn COMPLETED into AMBIGUOUS_OR_FAILED, and the next
    // attempt would re-execute a state-gated effect, produce empty evidence,
    // conflict with the first run's receipt and wedge the match.
    const key = "fence:lost-ack";
    let runs = 0;

    await expect(
      runGuardedEffectV2(
        {
          key,
          kind: "v2-test",
          apply: () => {
            runs += 1;
            return Promise.resolve(applied);
          },
        },
        { database: clientWhoseCompletionAckIsLost() },
      ),
    ).rejects.toThrow("connection reset before the completion was acked");

    const claim = await getScoutEffectClaim(key, prisma);
    expect(claim?.state).toBe("COMPLETED");

    const next = await runGuardedEffectV2(
      {
        key,
        kind: "v2-test",
        apply: () => {
          runs += 1;
          return Promise.resolve(applied);
        },
      },
      { database: prisma },
    );
    expect(runs).toBe(1);
    expect(next).toEqual({
      guard: { outcome: "already-applied" },
      fact: { outcome: "already-applied" },
      effects: 0,
    });
  }, 30_000);
});
