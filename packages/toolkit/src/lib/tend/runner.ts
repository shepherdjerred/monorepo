import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import type { PinchtabClientOptions } from "#lib/pinchtab-cli/http.ts";
import { sweepArtifacts } from "./artifacts.ts";
import { sweepDedupe } from "./dedupe.ts";
import {
  collectDockerDiskSummary,
  collectHostDiskCapacity,
  type StatDisk,
} from "./disk-summary.ts";
import { sweepDocker } from "./docker.ts";
import { listLeases, sweepLeases } from "./leases.ts";
import {
  collectLivenessSnapshot,
  type ForumNoticesFetcher,
} from "./liveness.ts";
import {
  DEFAULT_WORKTREE_MIN_AGE_MS,
  resolveTendPaths,
  type TendPaths,
} from "./paths.ts";
import { sweepPostgres } from "./postgres.ts";
import type { SharedPostgresAdapter } from "./postgres-databases.ts";
import { defaultCommandRunner, defaultTcpPortProbe } from "./process-probe.ts";
import { type ProcessSignaler, sweepProcesses } from "./processes.ts";
import { acquireTendRunLockWaiting, type LockTiming } from "./run-lock.ts";
import { sweepTailscaleServe } from "./tailscale-serve.ts";
import {
  type CommandRunner,
  type LivenessSnapshot,
  type SurfaceSweepResult,
  type TcpPortProbe,
  TEND_SURFACES,
  type TendItemEvent,
  type TendRunReport,
  type TendRunSummaryEvent,
  TendRunSummaryEventSchema,
  type TendSurface,
} from "./types.ts";
import { sweepWorktrees } from "./worktrees.ts";

export async function readLastTendRunSummary(
  paths: TendPaths = resolveTendPaths(),
): Promise<TendRunSummaryEvent | null> {
  const file = Bun.file(paths.eventsFile);
  if (!(await file.exists())) {
    return null;
  }
  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
      const line = lines[idx];
      if (line === undefined) {
        continue;
      }
      try {
        const parsed = TendRunSummaryEventSchema.safeParse(JSON.parse(line));
        if (parsed.success) {
          return parsed.data;
        }
      } catch {
        // Skip malformed or item event lines.
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function appendTendEvents(options: {
  readonly paths: TendPaths;
  readonly summary: TendRunSummaryEvent;
  readonly items: readonly TendItemEvent[];
}): Promise<void> {
  await mkdir(options.paths.rootDir, { recursive: true, mode: 0o700 });
  const lines = [
    ...options.items.map((item) => JSON.stringify(item)),
    JSON.stringify(options.summary),
  ];
  await appendFile(options.paths.eventsFile, `${lines.join("\n")}\n`, {
    mode: 0o600,
  });
}

export type RunTendOptions = {
  readonly mode: "status" | "run";
  readonly apply?: boolean | undefined;
  readonly surfaces?: readonly TendSurface[] | undefined;
  readonly worktreeMinAgeMs?: number | undefined;
  readonly gitDirs?: readonly string[] | undefined;
  readonly checkPullRequests?: boolean | undefined;
  readonly includeClosedPrs?: boolean | undefined;
  readonly immediateProxies?: boolean | undefined;
  readonly offline?: boolean | undefined;
  readonly paths?: TendPaths | undefined;
  readonly homeDir?: string | undefined;
  readonly tempDirs?: readonly string[] | undefined;
  readonly runner?: CommandRunner | undefined;
  readonly probePort?: TcpPortProbe | undefined;
  readonly fetchForumNotices?: ForumNoticesFetcher | undefined;
  readonly sharedPostgresAdapter?: SharedPostgresAdapter | undefined;
  readonly processSignaler?: ProcessSignaler | undefined;
  readonly livenessOverride?: LivenessSnapshot | undefined;
  readonly pinchtab?: PinchtabClientOptions | undefined;
  readonly statDisk?: StatDisk | undefined;
  /** Smallest file the dedupe surface replaces with a clone. */
  readonly dedupeMinSizeBytes?: number | undefined;
  /** Limit the dedupe surface to replacing files in this one worktree. */
  readonly dedupeWorktree?: string | undefined;
  /** `false` never refreshes an index after dedupe replaces files. */
  readonly dedupeRefreshIndex?: boolean | undefined;
  /** How long an applied run waits for another applied run to finish. */
  readonly lockWaitMs?: number | undefined;
  readonly lockTiming?: LockTiming | undefined;
  readonly nowMs?: number | undefined;
};

async function executeSelectedSurface(
  surface: TendSurface,
  ctx: {
    readonly options: RunTendOptions;
    readonly apply: boolean;
    readonly liveness: LivenessSnapshot;
    readonly paths: TendPaths;
    readonly runner: CommandRunner;
    readonly probePort: TcpPortProbe;
    readonly worktreeMinAgeMs: number;
    readonly nowMs: number;
    readonly classifiedLeases: Awaited<ReturnType<typeof listLeases>>;
  },
): Promise<SurfaceSweepResult> {
  switch (surface) {
    case "worktrees":
      return sweepWorktrees({
        liveness: ctx.liveness,
        leases: ctx.classifiedLeases,
        runner: ctx.runner,
        apply: ctx.apply,
        worktreeMinAgeMs: ctx.worktreeMinAgeMs,
        gitDirs: ctx.options.gitDirs,
        homeDir: ctx.options.homeDir,
        checkPullRequests: ctx.options.checkPullRequests,
        includeClosedPrs: ctx.options.includeClosedPrs,
        nowMs: ctx.nowMs,
      });
    case "dedupe":
      // Planning reads every worktree's index and takes the better part of a
      // minute, which a status report should not cost unless asked for.
      if (
        ctx.options.mode === "status" &&
        ctx.options.surfaces?.includes("dedupe") !== true
      ) {
        return {
          surface: "dedupe",
          skippedReason: "planning pass; run `toolkit tend dedupe`",
          inspectedCount: 0,
          candidates: [],
          actions: [],
          warnings: [],
        };
      }
      return sweepDedupe({
        liveness: ctx.liveness,
        runner: ctx.runner,
        apply: ctx.apply,
        paths: ctx.paths,
        gitDirs: ctx.options.gitDirs,
        homeDir: ctx.options.homeDir,
        minSizeBytes: ctx.options.dedupeMinSizeBytes,
        worktree: ctx.options.dedupeWorktree,
        refreshIndex: ctx.options.dedupeRefreshIndex,
        nowMs: ctx.nowMs,
      });
    case "postgres":
      return sweepPostgres({
        liveness: ctx.liveness,
        runner: ctx.runner,
        probePort: ctx.probePort,
        sharedAdapter: ctx.options.sharedPostgresAdapter,
        tempDirs: ctx.options.tempDirs,
        apply: ctx.apply,
        nowMs: ctx.nowMs,
      });
    case "processes":
      return sweepProcesses({
        liveness: ctx.liveness,
        leases: ctx.classifiedLeases,
        runner: ctx.runner,
        probePort: ctx.probePort,
        signaler: ctx.options.processSignaler,
        apply: ctx.apply,
      });
    case "tailscale-serve":
      return sweepTailscaleServe({
        leases: ctx.classifiedLeases,
        runner: ctx.runner,
        probePort: ctx.probePort,
        paths: ctx.paths,
        apply: ctx.apply,
        persistState: ctx.options.mode === "run",
        immediateProxies: ctx.options.immediateProxies,
      });
    case "docker":
      return sweepDocker({
        liveness: ctx.liveness,
        leases: ctx.classifiedLeases,
        runner: ctx.runner,
        apply: ctx.apply,
        nowMs: ctx.nowMs,
      });
    case "artifacts":
      return sweepArtifacts({
        liveness: ctx.liveness,
        leases: ctx.classifiedLeases,
        runner: ctx.runner,
        homeDir: ctx.options.homeDir,
        tempDirs: ctx.options.tempDirs,
        apply: ctx.apply,
        nowMs: ctx.nowMs,
      });
    case "leases": {
      const res = await sweepLeases({
        paths: ctx.paths,
        nowMs: ctx.nowMs,
        processes: ctx.liveness.processes,
        apply: ctx.apply,
        pinchtab: ctx.options.pinchtab,
      });
      return res.sweep;
    }
  }
}

function summarizeSurfaceResults(options: {
  readonly surfaceResults: readonly SurfaceSweepResult[];
  readonly tsIso: string;
  readonly host: string;
  readonly apply: boolean;
}) {
  let candidateCount = 0;
  let removedCount = 0;
  let failedCount = 0;
  const itemEvents: TendItemEvent[] = [];

  for (const sr of options.surfaceResults) {
    candidateCount += sr.candidates.length;
    for (const action of sr.actions) {
      if (action.status === "removed") {
        removedCount += 1;
      } else if (action.status === "failed") {
        failedCount += 1;
      }
      itemEvents.push({
        type: "item",
        ts: options.tsIso,
        host: options.host,
        apply: options.apply,
        surface: sr.surface,
        kind: action.candidate.kind,
        target: action.candidate.target,
        status: action.status,
        reason: action.candidate.reason,
        ...(action.detail === undefined ? {} : { detail: action.detail }),
      });
    }
  }
  return { candidateCount, removedCount, failedCount, itemEvents };
}

function resolveReportMode(
  mode: "status" | "run",
  apply: boolean,
): TendRunReport["mode"] {
  if (mode === "status") {
    return "status";
  }
  return apply ? "apply" : "dry-run";
}

export async function runTend(options: RunTendOptions): Promise<TendRunReport> {
  const startedMs = Date.now();
  const nowMs = options.nowMs ?? startedMs;
  const apply = options.mode === "run" && options.apply === true;
  const paths = options.paths ?? resolveTendPaths({ homeDir: options.homeDir });
  const runner = options.runner ?? defaultCommandRunner;
  const probePort = options.probePort ?? defaultTcpPortProbe;
  const worktreeMinAgeMs =
    options.worktreeMinAgeMs ?? DEFAULT_WORKTREE_MIN_AGE_MS;
  // Canonical order whatever --only said: dedupe shares what the reaper kept.
  const selectedSurfaces = TEND_SURFACES.filter((surface) =>
    (options.surfaces ?? TEND_SURFACES).includes(surface),
  );
  // Only a run that changes something takes the lock; a dry run never waits.
  const releaseLock = apply
    ? await acquireTendRunLockWaiting({
        paths,
        runner,
        waitMs: options.lockWaitMs,
        timing: options.lockTiming,
      })
    : undefined;

  try {
    const lastRunBefore = await readLastTendRunSummary(paths);
    const liveness =
      options.livenessOverride ??
      (await collectLivenessSnapshot({
        runner,
        fetchForumNotices: options.fetchForumNotices,
        offline: options.offline,
        homeDir: options.homeDir,
        nowMs,
      }));
    const homeDir = options.homeDir ?? Bun.env["HOME"] ?? os.homedir();
    const [disk, dockerDisk, classifiedLeases] = await Promise.all([
      collectHostDiskCapacity(homeDir, options.statDisk),
      collectDockerDiskSummary(options.mode, selectedSurfaces, runner),
      listLeases({ paths, nowMs, processes: liveness.processes }),
    ]);

    const surfaceResults: SurfaceSweepResult[] = [];
    for (const surface of selectedSurfaces) {
      surfaceResults.push(
        await executeSelectedSurface(surface, {
          options,
          apply,
          liveness,
          paths,
          runner,
          probePort,
          worktreeMinAgeMs,
          nowMs,
          classifiedLeases,
        }),
      );
    }

    const tsIso = new Date(nowMs).toISOString();
    const { candidateCount, removedCount, failedCount, itemEvents } =
      summarizeSurfaceResults({
        surfaceResults,
        tsIso,
        host: liveness.localHost,
        apply,
      });
    const holdRecord = Object.fromEntries(liveness.holdSurfaces);

    if (options.mode === "run") {
      await appendTendEvents({
        paths,
        summary: {
          type: "run",
          ts: tsIso,
          host: liveness.localHost,
          apply,
          surfaces: [...selectedSurfaces],
          candidateCount,
          removedCount,
          failedCount,
          heldSurfaces: holdRecord,
          durationMs: Math.max(0, Date.now() - startedMs),
        },
        items: itemEvents,
      });
    }

    const warnings =
      disk?.warning === undefined
        ? liveness.warnings
        : [...liveness.warnings, disk.warning];

    return {
      timestamp: tsIso,
      host: liveness.localHost,
      mode: resolveReportMode(options.mode, apply),
      worktreeMinAgeMs,
      disk,
      ...(dockerDisk === null ? {} : { dockerDisk }),
      liveness: {
        hcAvailable: liveness.hcAvailable,
        liveTerminalCount: liveness.hcTerminals.length,
        forumAvailable: liveness.forumAvailable,
        activeHostNotices: liveness.forumNotices,
        holdSurfaces: holdRecord,
        warnings,
      },
      surfaces: surfaceResults,
      totals: {
        candidates: candidateCount,
        removed: removedCount,
        failed: failedCount,
      },
      lastRun: lastRunBefore,
    };
  } finally {
    await releaseLock?.();
  }
}
