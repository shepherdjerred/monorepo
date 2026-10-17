import { afterAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  runGuardedEffect,
  type GuardedEffect,
  type ScoutEffectFence,
  type ScoutEffectFenceBudget,
} from "#src/temporal/effect-fence.ts";

const { prisma } = createTestDatabase("scout-v2-effect-fence");

afterAll(async () => {
  await prisma.$disconnect();
});

const applied = { fact: { outcome: "applied" } as const, effects: 3 };

async function sleep(ms: number): Promise<void> {
  await new Promise((done) => setTimeout(done, ms));
}

/**
 * The durable fact an effect records as its last write, as the caller's probe
 * reads it back. In production this is a receipt row; here it is the same
 * contract held in memory so each test controls exactly what stands.
 */
function factStore() {
  const facts = new Map<string, GuardedEffect>();
  return {
    facts,
    record(key: string, effects: number): GuardedEffect {
      facts.set(key, {
        fact: { outcome: "already-applied" },
        effects,
      });
      return applied;
    },
    probe(key: string) {
      return () => Promise.resolve(facts.get(key) ?? null);
    },
  };
}

describe("the V2 effect fence", () => {
  test("applies once and reports the guard and the fact apart", async () => {
    const store = factStore();
    let runs = 0;
    const result = await runGuardedEffect(
      {
        key: "fence:first",
        alreadyApplied: store.probe("fence:first"),
        apply: () => {
          runs += 1;
          return Promise.resolve(store.record("fence:first", 3));
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
  });

  test("skips an effect whose fact already stands, and reports that fact", async () => {
    const store = factStore();
    let runs = 0;
    const run = async () =>
      await runGuardedEffect(
        {
          key: "fence:completed",
          alreadyApplied: store.probe("fence:completed"),
          apply: () => {
            runs += 1;
            return Promise.resolve(store.record("fence:completed", 7));
          },
        },
        { database: prisma },
      );

    await run();
    expect(await run()).toEqual({
      guard: { outcome: "already-applied" },
      fact: { outcome: "already-applied" },
      effects: 7,
    });
    expect(runs).toBe(1);
  });

  test("never lets two live attempts apply the same effect", async () => {
    // The hole the lock closes: a start-to-close retry fires while the first
    // attempt is STILL RUNNING, so both read "no fact yet". Without the
    // advisory lock the effect is applied twice; with it, the second attempt
    // waits and then observes the fact the first recorded.
    const store = factStore();
    let concurrent = 0;
    let overlapped = false;
    const applications: string[] = [];
    const firstEntered = Promise.withResolvers<undefined>();

    const attempt = async (name: string) =>
      await runGuardedEffect(
        {
          key: "fence:concurrent",
          alreadyApplied: store.probe("fence:concurrent"),
          apply: async () => {
            concurrent += 1;
            if (concurrent > 1) overlapped = true;
            applications.push(name);
            if (name === "first") {
              firstEntered.resolve(undefined);
              await sleep(300);
            }
            concurrent -= 1;
            return store.record("fence:concurrent", 3);
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
      effects: 3,
    });
  }, 30_000);

  test("re-applies an effect whose earlier attempt died before its fact", async () => {
    // Under the lock, no fact means no attempt that can still write got as far
    // as recording one, so the effect is owed and this attempt applies it.
    const store = factStore();
    let runs = 0;
    const key = "fence:dead-holder";
    await expect(
      runGuardedEffect(
        {
          key,
          alreadyApplied: store.probe(key),
          apply: () => {
            runs += 1;
            throw new Error("worker died mid-effect");
          },
        },
        { database: prisma },
      ),
    ).rejects.toThrow("worker died mid-effect");

    const recovered = await runGuardedEffect(
      {
        key,
        alreadyApplied: store.probe(key),
        apply: () => {
          runs += 1;
          return Promise.resolve(store.record(key, 3));
        },
      },
      { database: prisma },
    );

    expect(runs).toBe(2);
    expect(recovered).toEqual({
      guard: { outcome: "applied" },
      fact: { outcome: "applied" },
      effects: 3,
    });
  });

  test("reports an attempt that recorded its fact and died from that fact", async () => {
    // The exact state a worker leaves when it commits its durable fact and
    // dies before returning. Re-executing there is how two correct rules build
    // a permanent wedge — the state-gated effect finds nothing left to do,
    // records empty evidence, and conflicts with the standing receipt. The
    // `apply` below returns exactly that conflict, so a fence that re-applied
    // would fail this test the way the pipeline would fail in production.
    const store = factStore();
    const key = "fence:fact-then-death";
    store.record(key, 7);
    let applyRuns = 0;

    const result = await runGuardedEffect(
      {
        key,
        alreadyApplied: store.probe(key),
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
  });

  test("fails the Activity on a conflicting fact", async () => {
    // Reporting success here would let the Workflow write its stage receipt,
    // advance the cursor and bury the disagreement permanently.
    const store = factStore();
    const key = "fence:conflict";
    await expect(
      runGuardedEffect(
        {
          key,
          alreadyApplied: store.probe(key),
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
    ).rejects.toMatchObject({
      type: "DurableCommitConflict",
      nonRetryable: true,
    });
  });
});

describe("a fence whose lock cannot outlast its effect", () => {
  test("keeps holding the lock while a slow effect runs, and only warns", async () => {
    // The ruling this test pins: the warning threshold is telemetry, never a
    // release. A fence that returned on the timer would unwind its
    // transaction, drop the lock, and leave `apply()` still writing through
    // top-level connections — so the rival below would enter while the first
    // effect was live, which is the double-application the lock exists to
    // prevent.
    const store = factStore();
    const key = "fence:slow-but-held";
    const budget: ScoutEffectFenceBudget = {
      lockLifetimeMs: 30_000,
      slowEffectWarningMs: 50,
      fenceAbortLeadMs: 1000,
    };
    let concurrent = 0;
    let overlapped = false;
    const applications: string[] = [];
    const firstEntered = Promise.withResolvers<undefined>();

    const attempt = async (name: string) =>
      await runGuardedEffect(
        {
          key,
          alreadyApplied: store.probe(key),
          apply: async () => {
            concurrent += 1;
            if (concurrent > 1) overlapped = true;
            applications.push(name);
            if (name === "slow") {
              firstEntered.resolve(undefined);
              // Far past the 50ms warning, and far short of the 30s lock.
              await sleep(600);
            }
            concurrent -= 1;
            return store.record(key, 3);
          },
        },
        { database: prisma, budget },
      );

    const slow = attempt("slow");
    await firstEntered.promise;
    const rival = attempt("rival");
    await slow;
    const rivalResult = await rival;

    // The rival waited on the lock for the effect's TRUE duration and then
    // found the fact standing.
    expect(applications).toEqual(["slow"]);
    expect(overlapped).toBe(false);
    expect(rivalResult).toEqual({
      guard: { outcome: "already-applied" },
      fact: { outcome: "already-applied" },
      effects: 3,
    });
  }, 30_000);

  test("refuses to record the fact when the fence lapsed mid-effect", async () => {
    // The transaction's own timer expires while the effect is still running,
    // so Prisma rolls back and releases the advisory lock underneath it. The
    // effect's boundary check before its fact must refuse, so nothing claims
    // the effect finished, and the next attempt re-enters under a lock it
    // genuinely holds.
    const store = factStore();
    const key = "fence:lapsed";
    const budget: ScoutEffectFenceBudget = {
      lockLifetimeMs: 700,
      slowEffectWarningMs: 30_000,
      fenceAbortLeadMs: 100,
    };
    let runs = 0;

    await expect(
      runGuardedEffect(
        {
          key,
          alreadyApplied: store.probe(key),
          apply: async (fence) => {
            runs += 1;
            await sleep(1500);
            await fence.assertHeld();
            return store.record(key, 3);
          },
        },
        { database: prisma, budget },
      ),
    ).rejects.toThrow();

    expect(runs).toBe(1);
    expect(store.facts.has(key)).toBe(false);

    const recovered = await runGuardedEffect(
      {
        key,
        alreadyApplied: store.probe(key),
        apply: () => {
          runs += 1;
          return Promise.resolve(store.record(key, 3));
        },
      },
      { database: prisma },
    );
    expect(runs).toBe(2);
    expect(recovered.fact).toEqual({ outcome: "applied" });
  }, 30_000);
});

describe("a zombie effect whose fence lapsed", () => {
  test("cannot write past the lapse while a rival applies", async () => {
    // The interleaving the fence residual named: the effect outlives the lock
    // lifetime, Postgres releases the lock underneath it, a rival enters and
    // applies, and the zombie still has writes left. The zombie's write
    // boundary must refuse — otherwise its second write lands beside the
    // rival's and the effect is applied by two attempts at once.
    //
    // Mutation proof: make `assertHeld` a no-op and the zombie's marker "B"
    // lands after the rival's "R", failing the assertions below.
    const store = factStore();
    const markers = new Set<string>();
    const write = async (fence: ScoutEffectFence, name: string) => {
      await fence.assertHeld();
      markers.add(name);
    };
    const key = "fence:zombie-race";
    const budget: ScoutEffectFenceBudget = {
      lockLifetimeMs: 1200,
      slowEffectWarningMs: 30_000,
      fenceAbortLeadMs: 200,
    };
    let zombieSignalAborted = false;

    const zombie = runGuardedEffect(
      {
        key,
        alreadyApplied: store.probe(key),
        apply: async (fence) => {
          await write(fence, "zombie-A");
          // Outlive the lock: Prisma rolls the fence's transaction back at
          // 1.2s and the rival takes the lock right after.
          await sleep(2000);
          zombieSignalAborted = fence.signal.aborted;
          await write(fence, "zombie-B");
          return store.record(key, 3);
        },
      },
      { database: prisma, budget },
    );
    // Enter once the zombie's lock is gone, before the zombie wakes up.
    await sleep(1500);
    const rival = runGuardedEffect(
      {
        key,
        alreadyApplied: store.probe(key),
        apply: async (fence) => {
          await write(fence, "rival-R");
          return store.record(key, 3);
        },
      },
      { database: prisma },
    );

    const zombieOutcome = await zombie.then(
      () => "resolved",
      (error: unknown) => error,
    );
    const rivalResult = await rival;

    // The write the guard exists to stop, asserted first so a removed guard
    // fails HERE rather than on the shape of whatever error Prisma raised.
    expect(markers.has("zombie-B")).toBe(false);
    expect(markers.has("zombie-A")).toBe(true);
    expect(markers.has("rival-R")).toBe(true);
    expect(zombieSignalAborted).toBe(true);
    expect(zombieOutcome).toBeInstanceOf(Error);
    expect(zombieOutcome).toMatchObject({
      type: "EffectFenceLost",
      nonRetryable: true,
    });
    expect(rivalResult).toEqual({
      guard: { outcome: "applied" },
      fact: { outcome: "applied" },
      effects: 3,
    });
  }, 30_000);

  test("aborts the signal ahead of the lock's own timer", async () => {
    // The lead is what makes a boundary check just before the rollback
    // refuse instead of pass: the signal fires at lifetime minus lead, and a
    // check landing in that window sees it even though the transaction is
    // technically still open.
    const store = factStore();
    const key = "fence:abort-lead";
    const budget: ScoutEffectFenceBudget = {
      lockLifetimeMs: 2000,
      slowEffectWarningMs: 30_000,
      fenceAbortLeadMs: 1200,
    };
    let abortedAtCheck: boolean | null = null;

    await expect(
      runGuardedEffect(
        {
          key,
          alreadyApplied: store.probe(key),
          apply: async (fence) => {
            // Past the lead (0.8s), well short of the lock (2s).
            await sleep(1200);
            abortedAtCheck = fence.signal.aborted;
            await fence.assertHeld();
            return store.record(key, 3);
          },
        },
        { database: prisma, budget },
      ),
    ).rejects.toThrow("refusing to write past it");

    expect(abortedAtCheck).toBe(true);
    expect(store.facts.has(key)).toBe(false);
  }, 30_000);
});
