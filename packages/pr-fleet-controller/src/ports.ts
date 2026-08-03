import type {
  FleetControllerConfig,
  FleetSnapshot,
  PrIdentity,
  PrState,
  ReadinessEvidence,
  WorkerResult,
} from "./schemas.ts";
import type { FleetStore } from "./state.ts";
import type { RunEventCorrelation, RunEventKind } from "./run-events.ts";

export type CommandRequest = {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
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
  termination: "exit" | "timeout" | "abort";
};

export type FleetEnvironment = {
  listOpenPrs: () => Promise<PrIdentity[]>;
  refreshEvidence: (pr: PrIdentity) => Promise<ReadinessEvidence>;
  findWorktree: (branches: string[]) => Promise<string | null>;
  provisionWorktree: (pr: PrIdentity, stackId: string) => Promise<string>;
  assignWorktreeBranch: (worktree: string, pr: PrIdentity) => Promise<void>;
  runLocalCommand: (request: CommandRequest) => Promise<CommandResult>;
  startRestack: (pr: PrState, signal?: AbortSignal) => Promise<CommandResult>;
  continueRestack: (
    pr: PrState,
    paths: string[],
    signal?: AbortSignal,
  ) => Promise<CommandResult>;
  publishFix: (
    pr: PrState,
    paths: string[],
    message: string,
    signal?: AbortSignal,
  ) => Promise<{ headSha: string }>;
  publishRestack: (
    pr: PrState,
    signal?: AbortSignal,
  ) => Promise<{ headSha: string }>;
};

export type WorkerRunner = {
  run: (pr: PrState, signal: AbortSignal) => Promise<WorkerResult>;
};

export type FleetObserver = {
  onSnapshot: (snapshot: FleetSnapshot) => void;
  onChange: (change: string) => void;
  onMasterText: (text: string) => void;
};

export type FleetScheduler = {
  schedule: (callback: () => void, delayMs: number) => () => void;
};

export type FleetTelemetry = {
  runId: string;
  newId: (prefix: string) => string;
  traceId: (...parts: string[]) => string;
  record: (
    kind: RunEventKind,
    payload: Record<string, unknown>,
    correlation?: RunEventCorrelation,
  ) => void;
};

export type FleetControllerDependencies = {
  config: FleetControllerConfig;
  environment: FleetEnvironment;
  workerRunner: WorkerRunner;
  observer: FleetObserver;
  store?: FleetStore;
  scheduler?: FleetScheduler;
  telemetry?: FleetTelemetry;
};
