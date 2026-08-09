import type { Task } from "../../../domain/types";
import type { CommandQueueStorage } from "../CommandQueue";
import type { TaskStoreStorage } from "../../store/TaskStore";

/**
 * Snapshot-able in-memory storage fakes for the simulation harness.
 *
 * Split out of `harness.ts` only to keep each file inside the repository's
 * 500-line limit; `harness.ts` re-exports everything here, so importers are
 * unaffected.
 *
 * `clone()` is the crash/relaunch primitive: it copies the DURABLE bytes and
 * nothing else, so a rebuilt stack starts from exactly what survived the kill.
 */

export type MemoryQueueStorage = CommandQueueStorage & {
  clone: () => MemoryQueueStorage;
};

export function memoryQueueStorage(
  initial: { queue?: string | null; dead?: string | null } = {},
): MemoryQueueStorage {
  let queue = initial.queue ?? null;
  let dead = initial.dead ?? null;
  return {
    readQueue: () => Promise.resolve(queue),
    writeQueue: (d) => {
      queue = d;
      return Promise.resolve();
    },
    readDeadLetter: () => Promise.resolve(dead),
    writeDeadLetter: (d) => {
      dead = d;
      return Promise.resolve();
    },
    clone: () => memoryQueueStorage({ queue, dead }),
  };
}

export type MemoryStoreStorage = TaskStoreStorage & {
  clone: () => MemoryStoreStorage;
};

export function memoryStoreStorage(
  initial: {
    tasks?: Task[];
    aliases?: string | null;
    acknowledgedCompletionRestores?: string | null;
    counters?: string | null;
    lastSync?: number | null;
  } = {},
): MemoryStoreStorage {
  let tasks = initial.tasks ?? [];
  let aliases = initial.aliases ?? null;
  let acknowledgedCompletionRestores =
    initial.acknowledgedCompletionRestores ?? null;
  let counters = initial.counters ?? null;
  let lastSync = initial.lastSync ?? null;
  return {
    getTasks: () => Promise.resolve(tasks),
    setTasks: (t) => {
      tasks = t;
      return Promise.resolve();
    },
    getIdAliases: () => Promise.resolve(aliases),
    setIdAliases: (d) => {
      aliases = d;
      return Promise.resolve();
    },
    getAcknowledgedCompletionRestores: () =>
      Promise.resolve(acknowledgedCompletionRestores),
    setAcknowledgedCompletionRestores: (d) => {
      acknowledgedCompletionRestores = d;
      return Promise.resolve();
    },
    // Durable like everything else here: the id counters have to survive a
    // `relaunch`, which is precisely the transition that used to let a
    // reopened app re-mint a live `X-Mutation-Id`.
    getIdCounters: () => Promise.resolve(counters),
    setIdCounters: (d) => {
      counters = d;
      return Promise.resolve();
    },
    getLastSyncTime: () => Promise.resolve(lastSync),
    setLastSyncTime: (t) => {
      lastSync = t;
      return Promise.resolve();
    },
    clone: () =>
      memoryStoreStorage({
        tasks,
        aliases,
        acknowledgedCompletionRestores,
        counters,
        lastSync,
      }),
  };
}
