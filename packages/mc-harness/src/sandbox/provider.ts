import type { SandboxCreateRequest } from "#protocol/ipc.ts";
import type { SandboxRecord } from "./record.ts";

export type Progress = (message: string) => void;

/**
 * Where sandbox servers run: local Docker or the cluster's mc-sandbox
 * namespace. Each provider owns only the records of its own kind.
 */
export type SandboxProvider = {
  readonly kind: SandboxRecord["provider"];
  /** Fails loudly when the backend (daemon, cluster access) is unavailable. */
  preflight: () => Promise<void>;
  create: (
    request: SandboxCreateRequest,
    progress: Progress,
  ) => Promise<SandboxRecord>;
  /** Persisted sandboxes, with status reconciled against the backend. */
  list: () => Promise<SandboxRecord[]>;
  destroy: (id: string) => Promise<void>;
  /** Removes expired, non-kept sandboxes; returns their ids. */
  reap: (now: Date) => Promise<string[]>;
  logs: (record: SandboxRecord, tail: number) => Promise<string[]>;
};

/** What the daemon drives: every provider at once, routed per sandbox. */
export type SandboxBackend = Omit<SandboxProvider, "kind">;
