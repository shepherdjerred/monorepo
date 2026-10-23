import { createTestDatabase as createCluster } from "./postgres.ts";
import {
  seedDelivery as seed,
  testOperator as operator,
  testPublisher as publisher,
  testExecutor as executor,
} from "./seed.ts";
import { Delivery as Store } from "#infrastructure/delivery.ts";
import { createApp as app } from "#server/app.ts";
import { createRecoveryInspector as recoveryInspector } from "#infrastructure/recovery.ts";
import {
  workerFixture as workers,
  freshWorkerProof as workerProof,
} from "./worker-fixture.ts";
import type { WorkerPoolTarget, WorkerVersion } from "#shared/contract.ts";
import { platformFixture as platform } from "./platform-fixture.ts";
import { controlPlaneFixture as controller } from "./control-plane-fixture.ts";
import { replicateProducedArtifacts as replicate } from "./replication.ts";

export const createTestDatabase = () => createCluster();
export const seedDelivery = (delivery: Store) => seed(delivery);
export const testOperator = { ...operator };
export const testPublisher = { ...publisher };
export const testExecutor = { ...executor };
export class Delivery extends Store {}
export const platformFixture = (
  database: Parameters<typeof platform>[0],
  delegated?: boolean,
) => platform(database, delegated);
export const controlPlaneFixture = (
  database: Parameters<typeof controller>[0],
  delegated?: boolean,
  beforeRegistration?: Parameters<typeof controller>[2],
) => controller(database, delegated, beforeRegistration);
export const workerFixture = (delivery: Store, target?: WorkerPoolTarget) =>
  workers(delivery, target);
export const freshWorkerProof = (
  worker: WorkerVersion,
  currentBuildId: string,
  timestamp?: number,
) => workerProof(worker, currentBuildId, timestamp);
export const createApp = (options: Parameters<typeof app>[0]) => app(options);
export const createRecoveryInspector = (
  options: Parameters<typeof recoveryInspector>[0],
) => recoveryInspector(options);
/** Test-only: read Applications from a fake API that serves `/api/v1/applications/:name`. */
export function fakeApplicationReader(origin: string, token: string) {
  return async (name: string): Promise<unknown> => {
    const response = await fetch(
      new URL(`/api/v1/applications/${encodeURIComponent(name)}`, origin),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `Fake Application read failed (${String(response.status)})`,
      );
    const body: unknown = await response.json();
    return body;
  };
}
export const replicateProducedArtifacts = (delivery: Store, buildId: string) =>
  replicate(delivery, buildId);
