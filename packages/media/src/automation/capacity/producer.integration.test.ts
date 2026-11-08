import { expect, test } from "vitest";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import { readCapacityView } from "#infrastructure/capacity/read.ts";
import { createCapacityNetworkProducer } from "./network.ts";
import { createCapacityRootIO } from "./io.ts";
import { capacityHarness, execution } from "./test-support.ts";

const f = capacityHarness();
test("actual canonical observer to real statfs to public projection works in observe without any file authority", async () => {
  const runtime = await f.db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  expect(runtime).toMatchObject({ mode: "observe", ownershipConfirmed: false });
  const cycle = await f.cycle();
  expect(await f.files()(cycle, execution())).toEqual({
    status: "completed",
    sampled: 2,
    unavailable: 0,
  });
  const view = await readCapacityView(f.db, { samplingEnabled: true });
  expect(view.roles.map((role) => role.state)).toEqual(["current", "current"]);
  for (const role of view.roles)
    expect(BigInt(role.totalBytes ?? "0")).toBeGreaterThan(0n);
  expect(JSON.stringify(view)).not.toMatch(
    /\/data\/|pvc|pod|inode|device|digest|revision/iu,
  );
  expect(await f.db.mediaStorageAuthority.count()).toBe(0);
  expect(await f.db.legacyWriterLease.count()).toBe(0);
});
test("disabled gates run once per invocation before counter allocation or IO and preserve valid readings", async () => {
  const cycle = await f.cycle();
  await f.files()(cycle, execution());
  const before = await f.db.mediaCapacityObservation.findMany({
    orderBy: { role: "asc" },
  });
  let flags = 0;
  const enabled = () => {
    flags++;
    return Promise.resolve(false);
  };
  const network = createCapacityNetworkProducer({
    db: f.db,
    enabled,
    observeMounts: () => {
      throw new Error("Unexpected network");
    },
  });
  expect(await network(execution())).toEqual({ status: "disabled" });
  expect(
    await f.files({
      enabled,
      io: {
        sample: () => {
          throw new Error("Unexpected filesystem");
        },
      },
    })(cycle, execution()),
  ).toEqual({ status: "disabled", sampled: 0, unavailable: 0 });
  expect(flags).toBe(2);
  expect(
    await f.db.mediaCapacityObservation.findMany({ orderBy: { role: "asc" } }),
  ).toEqual(before);
  const view = await readCapacityView(f.db, { samplingEnabled: false });
  expect(view.samplingEnabled).toBe(false);
  expect(view.roles.map((role) => role.state)).toEqual(["current", "current"]);
});
test("benign fresh mount renewal retains prior sample; changed Pod identity hides it", async () => {
  await f.files()(await f.cycle(), execution());
  const sample = await f.db.mediaCapacityObservation.findUniqueOrThrow({
    where: { role: "movies" },
  });
  await f.cycle();
  const renewed = await readCapacityView(f.db, { samplingEnabled: true });
  expect(renewed.roles[0]?.state).toBe("current");
  const saved = await f.db.mediaCapacityObservation.findUniqueOrThrow({
    where: { role: "movies" },
  });
  expect(saved.sampleObservedAt).toEqual(sample.sampleObservedAt);
  const changed = createCapacityNetworkProducer({
    db: f.db,
    enabled: () => Promise.resolve(true),
    observeMounts: async () => {
      const proof = await f.proof();
      return {
        ...proof,
        mounts: proof.mounts.map((mount) => ({
          ...mount,
          podUid: "replacement-pod",
        })),
      };
    },
  });
  const cycle = await changed(execution());
  if (cycle.status !== "observed")
    throw new Error("Expected changed mount observation");
  const changedView = await readCapacityView(f.db, { samplingEnabled: true });
  expect(changedView.roles[0]?.state).toBe("root_changed");
  expect(
    await f.files({
      io: {
        sample: () => {
          throw new Error("Wrong worker cannot measure");
        },
      },
    })(cycle.cycle, execution()),
  ).toMatchObject({ sampled: 0, unavailable: 2 });
});
test("bad configured canonical root cannot use trusted test mapper to bypass production path check", async () => {
  const cycle = await f.cycle();
  expect(
    await f.files({
      roots: { ...CAPACITY_ROOTS, movies: "/data/other", tv: "/data/other" },
      io: {
        sample: () => {
          throw new Error("Mapper must remain unused");
        },
      },
    })(cycle, execution()),
  ).toMatchObject({ sampled: 0, unavailable: 2 });
  const view = await readCapacityView(f.db, { samplingEnabled: true });
  expect(view.roles.map((role) => role.reason)).toEqual([
    "root_configuration_mismatch",
    "root_configuration_mismatch",
  ]);
});
test("zero available remains valid; known measurement failure replaces it with explicit unavailable", async () => {
  const cycle = await f.cycle();
  await f.files({
    io: createCapacityRootIO({
      resolve: f.root,
      statfs: () => Promise.resolve({ bsize: 4096n, blocks: 10n, bavail: 0n }),
    }),
  })(cycle, execution());
  const full = await readCapacityView(f.db, { samplingEnabled: true });
  expect(full.roles[0]).toMatchObject({
    state: "current",
    availableBytes: "0",
  });
  await f.files({
    io: createCapacityRootIO({
      resolve: f.root,
      statfs: () => {
        throw Object.assign(new Error("private filesystem location"), {
          code: "EIO",
        });
      },
    }),
  })(cycle, execution());
  const failed = await readCapacityView(f.db, { samplingEnabled: true });
  expect(failed.roles[0]).toMatchObject({
    state: "unavailable",
    reason: "statfs_failed",
    availableBytes: null,
  });
});
test("invalid configuration or missing runtime fails loudly with no manufactured epoch", async () => {
  const network = createCapacityNetworkProducer({
    db: f.db,
    enabled: () => {
      throw new Error("Invalid present flag");
    },
    observeMounts: () => {
      throw new Error("Unexpected IO");
    },
  });
  await expect(network(execution())).rejects.toThrow("Invalid present flag");
  expect(await f.db.mediaCapacityObservation.count()).toBe(0);
  await f.db.mediaRuntimeState.deleteMany();
  await expect(f.network()(execution())).rejects.toThrow();
  expect(await f.db.mediaCapacityObservation.count()).toBe(0);
});
