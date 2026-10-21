import { vi } from "vitest";
import type * as BackupStore from "@shepherdjerred/seaweedfs-backup/store";

type BackupStores = ReturnType<typeof BackupStore.storesFromEnvironment>;

/**
 * Activity context and store spies for tests that run backup activities.
 * A test loads this file with `await vi.hoisted(() => import(...))` and passes
 * `activityContextModule` and `backupStoreModule` to `vi.mock` as the factories
 * for `@temporalio/activity` and the backup store module, so the mocks and the
 * test read the same state.
 */
export const activity = {
  cancellation: new AbortController(),
  heartbeat: vi.fn(),
  stores: vi.fn(),
};

/** Factory for `@temporalio/activity` whose Context heartbeats into `activity`. */
export function activityContextModule() {
  return {
    Context: {
      current: () => ({
        cancellationSignal: activity.cancellation.signal,
        heartbeat: activity.heartbeat,
      }),
    },
  };
}

/** Factory for the real backup store module with `storesFromEnvironment` answered by `activity.stores`. */
export async function backupStoreModule(
  importOriginal: () => Promise<typeof BackupStore>,
) {
  return {
    ...(await importOriginal()),
    storesFromEnvironment: activity.stores,
  };
}

/**
 * Gives the next test a fresh cancellation signal and cleared spies.
 * `storesFor` receives the execution options the activity passed to
 * `storesFromEnvironment` and returns the stores it should see.
 */
export function resetBackupActivity(
  storesFor: (
    execution: BackupStore.ObjectStoreExecution | undefined,
  ) => BackupStores,
) {
  activity.cancellation = new AbortController();
  activity.heartbeat.mockReset();
  activity.stores.mockReset();
  activity.stores.mockImplementation(
    (_environment: unknown, execution?: BackupStore.ObjectStoreExecution) =>
      storesFor(execution),
  );
}
