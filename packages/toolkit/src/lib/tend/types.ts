import { z } from "zod";

export const TEND_SURFACES = [
  "worktrees",
  "postgres",
  "processes",
  "tailscale-serve",
  "docker",
  "artifacts",
  "leases",
] as const;

export const TendSurfaceSchema = z.enum(TEND_SURFACES);
export type TendSurface = z.infer<typeof TendSurfaceSchema>;

export const LeaseKindSchema = z.enum([
  "tailscale-serve",
  "cloudflared",
  "docker-container",
  "dir",
  "process",
  "pinchtab",
  "temporal",
]);
export type LeaseKind = z.infer<typeof LeaseKindSchema>;

export const LeaseSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1),
  kind: LeaseKindSchema,
  target: z.string().min(1),
  ownerPid: z.number().int().positive(),
  processStart: z.string().min(1),
  hcTerminal: z.string().min(1).optional(),
  worktree: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
});
export type Lease = z.infer<typeof LeaseSchema>;

export type LeaseStatus = "active" | "expired" | "dead-owner";

export type ClassifiedLease = {
  readonly lease: Lease;
  readonly status: LeaseStatus;
  readonly reason: string;
};

export const TendStateSchema = z.strictObject({
  version: z.literal(1),
  tailscaleStrikes: z.record(z.string(), z.number().int().nonnegative()),
});
export type TendState = z.infer<typeof TendStateSchema>;

export type CommandExecOptions = {
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly timeoutMs?: number | undefined;
};

export type CommandExecResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean | undefined;
};

export type CommandRunner = (
  argv: readonly string[],
  options?: CommandExecOptions,
) => Promise<CommandExecResult>;

export type TcpPortProbe = (host: string, port: number) => Promise<boolean>;

export type OsProcessEntry = {
  readonly pid: number;
  readonly ppid: number;
  readonly processStart: string;
  readonly elapsedSeconds: number;
  readonly command: string;
  readonly args: string;
  readonly cwd?: string | undefined;
};

export type HcTerminalEntry = {
  readonly address: string;
  readonly cwd: string;
  readonly foregroundCwd?: string | undefined;
  readonly pid?: number | undefined;
  readonly agent?: string | undefined;
};

export type ForumNoticeSummary = {
  readonly id: string;
  readonly title: string;
  readonly scopes: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly holdsDatabasesOrTesting: boolean;
};

export type LivenessSnapshot = {
  readonly capturedAt: string;
  readonly platform: NodeJS.Platform;
  readonly localHost: string;
  readonly localHostAliases: ReadonlySet<string>;
  readonly hcAvailable: boolean;
  readonly hcTerminals: readonly HcTerminalEntry[];
  readonly protectedPaths: ReadonlySet<string>;
  readonly processCwds: ReadonlySet<string>;
  readonly herdrActivePaths: ReadonlySet<string>;
  readonly forumNoticePaths: ReadonlySet<string>;
  readonly forumNotices: readonly ForumNoticeSummary[];
  readonly forumAvailable: boolean;
  readonly holdSurfaces: ReadonlyMap<TendSurface, string>;
  readonly warnings: readonly string[];
  readonly processes: ReadonlyMap<number, OsProcessEntry>;
  readonly liveTerminalRelatedPids: ReadonlySet<number>;
};

export type TendCandidate = {
  readonly id: string;
  readonly surface: TendSurface;
  readonly kind: string;
  readonly target: string;
  readonly reason: string;
  readonly ageSeconds?: number | undefined;
  readonly metadata?:
    Readonly<Record<string, string | number | boolean>> | undefined;
};

export type TendActionStatus = "planned" | "removed" | "failed" | "skipped";

export type TendActionOutcome = {
  readonly candidate: TendCandidate;
  readonly status: TendActionStatus;
  readonly detail?: string | undefined;
};

export type SurfaceSweepResult = {
  readonly surface: TendSurface;
  readonly heldReason?: string | undefined;
  readonly skippedReason?: string | undefined;
  readonly inspectedCount: number;
  readonly candidates: readonly TendCandidate[];
  readonly actions: readonly TendActionOutcome[];
  readonly warnings: readonly string[];
};

export const TendRunSummaryEventSchema = z.strictObject({
  type: z.literal("run"),
  ts: z.string(),
  host: z.string(),
  apply: z.boolean(),
  surfaces: z.array(TendSurfaceSchema),
  candidateCount: z.number().int().nonnegative(),
  removedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  heldSurfaces: z.record(z.string(), z.string()),
  durationMs: z.number().nonnegative(),
});
export type TendRunSummaryEvent = z.infer<typeof TendRunSummaryEventSchema>;

export const TendItemEventSchema = z.strictObject({
  type: z.literal("item"),
  ts: z.string(),
  host: z.string(),
  apply: z.boolean(),
  surface: TendSurfaceSchema,
  kind: z.string(),
  target: z.string(),
  status: z.enum(["planned", "removed", "failed", "skipped"]),
  reason: z.string(),
  detail: z.string().optional(),
});
export type TendItemEvent = z.infer<typeof TendItemEventSchema>;

export type TendRunReport = {
  readonly timestamp: string;
  readonly host: string;
  readonly mode: "status" | "dry-run" | "apply";
  readonly worktreeMinAgeMs: number;
  readonly liveness: {
    readonly hcAvailable: boolean;
    readonly liveTerminalCount: number;
    readonly forumAvailable: boolean;
    readonly activeHostNotices: readonly ForumNoticeSummary[];
    readonly holdSurfaces: Readonly<Record<string, string>>;
    readonly warnings: readonly string[];
  };
  readonly surfaces: readonly SurfaceSweepResult[];
  readonly totals: {
    readonly candidates: number;
    readonly removed: number;
    readonly failed: number;
  };
  readonly lastRun: TendRunSummaryEvent | null;
};
