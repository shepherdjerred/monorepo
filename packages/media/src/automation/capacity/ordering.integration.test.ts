import { expect, test } from "vitest";
import { createDatabase } from "#infrastructure/database.ts";
import { LegacyObservationError } from "#integrations/legacy-observer/wire.ts";
import { createCapacityNetworkProducer } from "./network.ts";
import { createCapacityRootIO } from "./io.ts";
import { beginCapacityCycle } from "./ordering.ts";
import { finishCapacityMounts } from "./mounts.ts";
import { beginCapacitySample, finishCapacitySample } from "./sample.ts";
import { capacityHarness, execution } from "./test-support.ts";

const f = capacityHarness();
test.each(["success", "failure"] as const)(
  "older mount %s cannot replace a newer cycle",
  async (outcome) => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const older = createCapacityNetworkProducer({
      db: f.db,
      enabled: () => Promise.resolve(true),
      observeMounts: async () => {
        const proof = await f.proof();
        entered.resolve(undefined);
        await release.promise;
        if (outcome === "failure")
          throw new LegacyObservationError("synthetic_failure");
        return proof;
      },
    })(execution());
    try {
      await entered.promise;
      const latest = await f.cycle();
      release.resolve(undefined);
      expect(await older).toEqual({ status: "superseded" });
      const row = await f.db.mediaCapacityObservation.findUniqueOrThrow({
        where: { role: "movies" },
      });
      expect(row).toMatchObject({
        cycleRevision: BigInt(latest.cycles[0].revision),
        mountOutcome: "observed",
      });
    } finally {
      release.resolve(undefined);
      await older;
    }
  },
);
test.each(["success", "failure"] as const)(
  "same-cycle overlapping sample %s is fenced by sampleAttempt",
  async (outcome) => {
    const cycle = await f.cycle();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const older = f.files({
      io: createCapacityRootIO({
        resolve: f.root,
        statfs: async () => {
          entered.resolve(undefined);
          await release.promise;
          if (outcome === "failure")
            throw Object.assign(new Error("old read failed"), { code: "EIO" });
          return { bsize: 1n, blocks: 100n, bavail: 99n };
        },
      }),
    })(cycle, execution());
    try {
      await entered.promise;
      expect(
        await f.files({
          io: createCapacityRootIO({
            resolve: f.root,
            statfs: () =>
              Promise.resolve({ bsize: 1n, blocks: 100n, bavail: 25n }),
          }),
        })(cycle, execution()),
      ).toMatchObject({ sampled: 2 });
      release.resolve(undefined);
      expect(await older).toMatchObject({ status: "superseded" });
      expect(
        await f.db.mediaCapacityObservation.findUniqueOrThrow({
          where: { role: "movies" },
        }),
      ).toMatchObject({
        sampleAttempt: 2n,
        sampleResultAttempt: 2n,
        availableBytes: 25n,
      });
    } finally {
      release.resolve(undefined);
      await older;
    }
  },
);
test("epoch change commits while IO is paused and fences both late result and queued token", async () => {
  const cycle = await f.cycle();
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const older = f.files({
    io: createCapacityRootIO({
      resolve: f.root,
      statfs: async () => {
        entered.resolve(undefined);
        await release.promise;
        return { bsize: 1n, blocks: 100n, bavail: 99n };
      },
    }),
  })(cycle, execution());
  try {
    await entered.promise;
    await f.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { recoveryEpoch: 1 },
    });
    release.resolve(undefined);
    expect(await older).toMatchObject({ status: "superseded" });
    expect(
      await f.files({
        io: {
          sample: () => {
            throw new Error("Stale queued token must not read storage");
          },
        },
      })(cycle, execution()),
    ).toMatchObject({ status: "superseded" });
    const saved = await f.db.mediaCapacityObservation.findUniqueOrThrow({
      where: { role: "movies" },
    });
    expect(saved.sampleOutcome).toBeNull();
  } finally {
    release.resolve(undefined);
    await older;
  }
});
test("late cancellation and elapsed deadline after IO leave no success; a fresh invocation is independent", async () => {
  const cycle = await f.cycle();
  for (const mode of ["cancel", "deadline"] as const) {
    const abort = new AbortController();
    let expired = false;
    const run = {
      ...execution(),
      signal: abort.signal,
      assertActive: () => {
        if (expired) throw new Error("deadline");
      },
    };
    await expect(
      f.files({
        io: createCapacityRootIO({
          resolve: f.root,
          statfs: () => {
            if (mode === "cancel") abort.abort(new Error("cancelled"));
            else expired = true;
            return Promise.resolve({ bsize: 1n, blocks: 10n, bavail: 5n });
          },
        }),
      })(cycle, run),
    ).rejects.toThrow(mode === "cancel" ? "cancelled" : "deadline");
    const saved = await f.db.mediaCapacityObservation.findUniqueOrThrow({
      where: { role: "movies" },
    });
    expect(saved.sampleOutcome).toBeNull();
  }
  expect(await f.files()(cycle, execution())).toMatchObject({ sampled: 2 });
});
test("runtime lock wait exceeding an invocation deadline cannot allocate or commit fresh observations", async () => {
  const second = createDatabase(f.url);
  const locked = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let expired = false;
  const blocker = second.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR UPDATE`;
    locked.resolve(undefined);
    await release.promise;
  });
  let attempted = false;
  try {
    await locked.promise;
    const pending = beginCapacityCycle(f.db, {
      ...execution(),
      assertActive: () => {
        attempted = true;
        if (expired) throw new Error("deadline");
      },
    });
    // Wait until PostgreSQL itself confirms the reader is blocked on the held row.
    let waiting = false;
    for (let index = 0; !waiting && index < 100; index++) {
      const rows = await second.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query LIKE 'SELECT id FROM "MediaRuntimeState"%' AND wait_event_type='Lock') AS waiting`;
      waiting = rows[0]?.waiting === true;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(attempted && waiting).toBe(true);
    expired = true;
    release.resolve(undefined);
    await blocker;
    await expect(pending).rejects.toThrow("deadline");
    expect(await f.db.mediaCapacityObservation.count()).toBe(0);
  } finally {
    release.resolve(undefined);
    await blocker;
    await second.$disconnect();
  }
});
test("cancellation after an awaited capacity write rolls the entire transaction back", async () => {
  let checks = 0;
  const run = {
    ...execution(),
    assertActive: () => {
      if (++checks === 10) throw new Error("cancel after write");
    },
  };
  await expect(beginCapacityCycle(f.db, run)).rejects.toThrow(
    "cancel after write",
  );
  expect(await f.db.mediaCapacityObservation.count()).toBe(0);
});
test("expired canonical proof prevents files IO; stale mount failure cannot erase prior accepted result", async () => {
  const cycle = await beginCapacityCycle(f.db, execution());
  const proof = await f.proof();
  const past = new Date(Date.now() - 120_000);
  expect(
    await finishCapacityMounts(
      f.db,
      cycle,
      {
        status: "observed",
        evidence: {
          ...proof,
          capturedAt: past.toISOString(),
          expiresAt: new Date(past.getTime() + 90_000).toISOString(),
        },
      },
      execution(),
    ),
  ).toBe("stored");
  expect(
    await f.files({
      io: {
        sample: () => {
          throw new Error("Expired proof cannot read storage");
        },
      },
    })(cycle, execution()),
  ).toMatchObject({ sampled: 0, unavailable: 2 });
  const fresh = await f.cycle();
  expect(
    await finishCapacityMounts(
      f.db,
      fresh,
      { status: "unavailable", reason: "mount_observation_failed" },
      execution(),
    ),
  ).toBe("superseded");
});
test("missing and future sample evidence fail without replacing a committed reading", async () => {
  const cycle = await f.cycle();
  const start = await beginCapacitySample(f.db, cycle, execution());
  if (start.status !== "started") throw new Error("Expected sample start");
  const movies = start.roles[0];
  if (movies?.status !== "ready")
    throw new Error("Expected actual ready binding");
  await expect(
    finishCapacitySample(
      f.db,
      movies.token,
      {
        status: "observed",
        observedAt: new Date(Date.now() + 60_000).toISOString(),
        identity: { device: "1", inode: "2" },
        totalBytes: 100n,
        availableBytes: 10n,
      },
      execution(),
    ),
  ).rejects.toThrow("observation time");
  const saved = await f.db.mediaCapacityObservation.findUniqueOrThrow({
    where: { role: "movies" },
  });
  expect(saved.sampleOutcome).toBeNull();
});
