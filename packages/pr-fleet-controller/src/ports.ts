import type {
  FleetControllerConfig,
  FleetSnapshot,
  PrIdentity,
  PrState,
  ReadinessEvidence,
  WorkerResult,
} from "./schemas.ts";
import type { FleetStore } from "./state.ts";

export type CommandRequest = {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /**
   * Environment for the subprocess. Defaults to the controller's own
   * environment; model-driven worker commands pass a credential-scrubbed
   * environment so tool output cannot exfiltrate host secrets.
   */
  env?: Record<string, string | undefined>;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type FleetEnvironment = {
  listOpenPrs: () => Promise<PrIdentity[]>;
  refreshEvidence: (pr: PrIdentity) => Promise<ReadinessEvidence>;
  findWorktree: (branches: string[]) => Promise<string | null>;
  provisionWorktree: (pr: PrIdentity, stackId: string) => Promise<string>;
  assignWorktreeBranch: (worktree: string, branch: string) => Promise<void>;
  runLocalCommand: (request: CommandRequest) => Promise<CommandResult>;
  startRestack: (pr: PrState) => Promise<CommandResult>;
  continueRestack: (pr: PrState, paths: string[]) => Promise<CommandResult>;
  publishFix: (
    pr: PrState,
    paths: string[],
    message: string,
  ) => Promise<{ headSha: string }>;
  publishRestack: (pr: PrState) => Promise<{ headSha: string }>;
};

export type WorkerRunner = {
  run: (pr: PrState, signal: AbortSignal) => Promise<WorkerResult>;
};

export type FleetObserver = {
  onSnapshot: (snapshot: FleetSnapshot) => void;
  onChange: (change: string) => void;
  onMasterText: (text: string) => void;
};

export type FleetControllerDependencies = {
  config: FleetControllerConfig;
  environment: FleetEnvironment;
  workerRunner: WorkerRunner;
  observer: FleetObserver;
  store?: FleetStore;
};
