import { afterAll, beforeAll, beforeEach } from "vitest";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { canonicalFixture } from "#integrations/legacy-observer/canonical-fixture.ts";
import { legacyObserver } from "#integrations/legacy-observer/runtime.ts";
import {
  CAPACITY_ROOTS,
  type CapacityCycle,
} from "#shared/capacity/contract.ts";
import { createCapacityNetworkProducer } from "./network.ts";
import { createCapacityFileProducer } from "./files.ts";
import { createCapacityRootIO } from "./io.ts";
import type { CapacityExecution } from "./execution.ts";

export function execution(): CapacityExecution {
  const signal = new AbortController().signal;
  return {
    signal,
    checkpoint: () => Promise.resolve(),
    assertActive: () => {
      signal.throwIfAborted();
    },
  };
}
export function capacityHarness() {
  let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
  let directory: string;
  beforeAll(async () => {
    cluster = await startMediaTestPostgres();
    directory = await realpath(
      await mkdtemp(path.join(tmpdir(), "media-capacity-producer-")),
    );
    await mkdir(path.join(directory, "movies"));
    await mkdir(path.join(directory, "tv"));
  }, 60_000);
  beforeEach(async () => {
    await cluster.database.mediaCapacityObservation.deleteMany();
    await cluster.database.mediaRuntimeState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: { mode: "observe", recoveryEpoch: 0, ownershipConfirmed: false },
    });
  });
  afterAll(async () => {
    try {
      await cluster.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  return {
    get db() {
      return cluster.database;
    },
    get url() {
      return cluster.url;
    },
    root: (role: "movies" | "tv") => path.join(directory, role),
    async proof() {
      return await legacyObserver(
        canonicalFixture().request,
      ).observeCanonicalMounts();
    },
    network() {
      return createCapacityNetworkProducer({
        db: cluster.database,
        enabled: () => Promise.resolve(true),
        observeMounts: (signal) =>
          legacyObserver(canonicalFixture().request).observeCanonicalMounts(
            signal,
          ),
      });
    },
    files(
      options: Partial<Parameters<typeof createCapacityFileProducer>[0]> = {},
    ) {
      return createCapacityFileProducer({
        db: cluster.database,
        enabled: () => Promise.resolve(true),
        roots: CAPACITY_ROOTS,
        workerPodUid: "files-pod",
        io: createCapacityRootIO({
          resolve: (role) => path.join(directory, role),
        }),
        ...options,
      });
    },
    async cycle(): Promise<CapacityCycle> {
      const result = await this.network()(execution());
      if (result.status !== "observed")
        throw new Error("Actual canonical observer failed");
      return result.cycle;
    },
  };
}
