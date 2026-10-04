import type { SandboxCreateRequest } from "#protocol/ipc.ts";
import type { SandboxRecord } from "./record.ts";

export type Progress = (message: string) => void;

/**
 * Where sandbox servers run. Docker is the only provider so far; a Kubernetes
 * provider implements the same contract.
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
