import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";

/** Existing owner command composition. The unknown port supplies no terminal
 * observation, rather than fabricating a failed Workflow for the fixture. */
export function nativeSeriesPackRetryCommandsV1(
  service: PrismaNativeRecovery,
  db: Database,
  owner: MediaActor,
) {
  return {
    nativeRetry: (id: string, key: string, expectedVersion: number) =>
      service.retryCompensation(owner, key, id, { expectedVersion }),
    nativeUnknownRetry: (id: string, expectedVersion: number) =>
      new PrismaNativeRecovery(db, () =>
        Promise.reject(new Error("Actual SDK status unavailable")),
      ).retryCompensation(owner, crypto.randomUUID(), id, { expectedVersion }),
  };
}
