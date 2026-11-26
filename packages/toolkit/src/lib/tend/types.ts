import { z } from "zod";

export const TEND_SURFACES = [
  "worktrees",
  "dedupe",
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
  /** Text for the command's standard input; without it there is none. */
  readonly stdin?: string | undefined;
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

/**
 * `deduped` is the dedupe surface's applied outcome: files were replaced with
 * clones of identical content and nothing was removed.
 */
export type TendActionStatus =
  "planned" | "removed" | "deduped" | "failed" | "skipped";

export type TendActionOutcome = {
  readonly candidate: TendCandidate;
  readonly status: TendActionStatus;
  readonly detail?: string | undefined;
};

/**
 * What a sweep concluded about one inspected item, including the ones it
 * keeps. `category` is a stable, human-readable grouping for per-reason
 * counts; `reason` carries the specifics.
 */
export type TendDecision = {
  readonly target: string;
  readonly action: "keep" | "remove" | "prune-metadata";
  readonly category: string;
  readonly reason: string;
};

export type SurfaceSweepResult = {
  readonly surface: TendSurface;
  readonly heldReason?: string | undefined;
  readonly skippedReason?: string | undefined;
  readonly inspectedCount: number;
  readonly candidates: readonly TendCandidate[];
  readonly actions: readonly TendActionOutcome[];
  /** One record per inspected item, for surfaces that explain their keeps. */
  readonly decisions?: readonly TendDecision[] | undefined;
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
  status: z.enum(["planned", "removed", "deduped", "failed", "skipped"]),
  reason: z.string(),
  detail: z.string().optional(),
});
export type TendItemEvent = z.infer<typeof TendItemEventSchema>;

const GIB_BYTES = 1024 ** 3;
export const DISK_WARNING_THRESHOLD_BYTES = 20 * GIB_BYTES;
export const DISK_CRITICAL_THRESHOLD_BYTES = 5 * GIB_BYTES;

export type DiskCapacitySummary = {
  readonly path: string;
  readonly availableBytes: number;
  readonly totalBytes: number;
  readonly level: "ok" | "warning" | "critical";
  readonly warning?: string | undefined;
};

export type DockerDiskUsageRow = {
  readonly type: string;
  readonly totalCount: string;
  readonly active: string;
  readonly size: string;
  readonly reclaimable: string;
};

export type DockerDiskSummary = {
  readonly available: boolean;
  readonly rows: readonly DockerDiskUsageRow[];
  readonly skippedReason?: string | undefined;
};

const DockerSystemDfRowSchema = z.looseObject({
  Type: z.string(),
  TotalCount: z.union([z.string(), z.number()]).transform(String),
  Active: z.union([z.string(), z.number()]).transform(String),
  Size: z.string(),
  Reclaimable: z.string(),
});

export function formatGiB(bytes: number): string {
  return `${(bytes / GIB_BYTES).toFixed(1)} GiB`;
}

/** `512 B`, `64.0 KiB`, `1.8 GiB`. */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? "TiB"}`;
}

export function evaluateDiskCapacity(
  targetPath: string,
  availableBytes: number,
  totalBytes: number,
): DiskCapacitySummary {
  if (availableBytes < DISK_CRITICAL_THRESHOLD_BYTES) {
    return {
      path: targetPath,
      availableBytes,
      totalBytes,
      level: "critical",
      warning: `CRITICAL low disk space on ${targetPath}: ${formatGiB(availableBytes)} available (< 5 GiB)`,
    };
  }
  if (availableBytes < DISK_WARNING_THRESHOLD_BYTES) {
    return {
      path: targetPath,
      availableBytes,
      totalBytes,
      level: "warning",
      warning: `Low disk space on ${targetPath}: ${formatGiB(availableBytes)} available (< 20 GiB)`,
    };
  }
  return {
    path: targetPath,
    availableBytes,
    totalBytes,
    level: "ok",
  };
}

export function parseDockerSystemDfOutput(
  stdout: string,
): DockerDiskUsageRow[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const mapRow = (
    parsed: z.infer<typeof DockerSystemDfRowSchema>,
  ): DockerDiskUsageRow => ({
    type: parsed.Type,
    totalCount: parsed.TotalCount,
    active: parsed.Active,
    size: parsed.Size,
    reclaimable: parsed.Reclaimable,
  });
  if (trimmed.startsWith("[")) {
    try {
      const arrayParsed = z
        .array(DockerSystemDfRowSchema)
        .safeParse(JSON.parse(trimmed));
      return arrayParsed.success
        ? arrayParsed.data.map((item) => mapRow(item))
        : [];
    } catch {
      return [];
    }
  }
  const rows: DockerDiskUsageRow[] = [];
  for (const line of trimmed.split(/\r?\n/u)) {
    const clean = line.trim();
    if (clean.length === 0) {
      continue;
    }
    try {
      const parsed = DockerSystemDfRowSchema.safeParse(JSON.parse(clean));
      if (parsed.success) {
        rows.push(mapRow(parsed.data));
      }
    } catch {
      // Ignore unparseable line.
    }
  }
  return rows;
}

export type TendRunReport = {
  readonly timestamp: string;
  readonly host: string;
  readonly mode: "status" | "dry-run" | "apply";
  readonly worktreeMinAgeMs: number;
  readonly disk?: DiskCapacitySummary | null | undefined;
  readonly dockerDisk?: DockerDiskSummary | null | undefined;
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
