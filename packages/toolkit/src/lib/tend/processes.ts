import { lstat } from "node:fs/promises";
import { z } from "zod";
import {
  formatDurationCompact,
  isPathProtected,
  isUnderProtectedPrefix,
} from "./paths.ts";
import {
  defaultCommandRunner,
  defaultTcpPortProbe,
  isProcessAliveByKillZero,
  processStartsMatch,
  readSingleProcessStart,
} from "./process-probe.ts";
import type {
  ClassifiedLease,
  CommandRunner,
  LivenessSnapshot,
  OsProcessEntry,
  SurfaceSweepResult,
  TcpPortProbe,
  TendActionOutcome,
  TendCandidate,
} from "./types.ts";

const ORPHAN_PROCESS_MIN_AGE_SECONDS = 15 * 60;

const StormBootstrapSchema = z.looseObject({
  socket: z.string().min(1).optional(),
});

export type ProcessSignaler = {
  readonly kill: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  readonly isAlive: (pid: number) => boolean;
  readonly readStart: (pid: number) => Promise<string | undefined>;
  readonly sleep: (ms: number) => Promise<void>;
};

function createDefaultSignaler(
  runner: CommandRunner,
  platform: NodeJS.Platform,
): ProcessSignaler {
  return {
    kill: (pid, signal) => {
      process.kill(pid, signal);
    },
    isAlive: isProcessAliveByKillZero,
    readStart: (pid) => readSingleProcessStart(pid, { runner, platform }),
    sleep: (ms) => Bun.sleep(ms),
  };
}

export function hasLiveMcHarnessDaemon(
  processes: ReadonlyMap<number, OsProcessEntry>,
): boolean {
  for (const proc of processes.values()) {
    if (
      proc.args.includes("mc-harness/src/daemon/main.ts") ||
      proc.args.includes(String.raw`mc-harness\src\daemon\main.ts`) ||
      proc.args.includes("toolkit mc daemon")
    ) {
      return true;
    }
  }
  return false;
}

async function stormSessionAlive(sessionArgValue: string): Promise<boolean> {
  const file = Bun.file(sessionArgValue);
  if (!(await file.exists())) {
    return false;
  }
  try {
    const parsed = StormBootstrapSchema.safeParse(
      JSON.parse(await file.text()),
    );
    if (!parsed.success || parsed.data.socket === undefined) {
      return false;
    }
    const info = await lstat(parsed.data.socket);
    return info.isSocket();
  } catch {
    return false;
  }
}

function parseCloudflaredQuickTunnelPort(args: string): number | null {
  if (!args.includes("cloudflared") || !args.includes("tunnel")) {
    return null;
  }
  const match =
    /--url(?:=|\s+)["']?https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/iu.exec(
      args,
    );
  if (match?.[1] === undefined) {
    return null;
  }
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

function parseStormSessionPath(args: string): string | null {
  const match = /-Dstorm\.client\.session=([^\s"']+)/u.exec(args);
  return match?.[1] ?? null;
}

function isOrphanParent(
  proc: OsProcessEntry,
  processes: ReadonlyMap<number, OsProcessEntry>,
  platform: NodeJS.Platform,
): boolean {
  return platform === "win32"
    ? proc.ppid === 0 || !processes.has(proc.ppid)
    : proc.ppid === 1;
}

function collectLeaseProtectedPids(
  leases: readonly ClassifiedLease[],
): Set<number> {
  const protectedPids = new Set<number>();
  for (const item of leases) {
    if (item.status !== "active") {
      continue;
    }
    protectedPids.add(item.lease.ownerPid);
    if (
      item.lease.kind === "process" ||
      item.lease.kind === "temporal" ||
      item.lease.kind === "cloudflared" ||
      item.lease.kind === "pinchtab"
    ) {
      const targetPid = Number(item.lease.target);
      if (Number.isInteger(targetPid) && targetPid > 0) {
        protectedPids.add(targetPid);
      }
    }
  }
  return protectedPids;
}

async function classifyOrphanProcess(options: {
  readonly proc: OsProcessEntry;
  readonly mcDaemonLive: boolean;
  readonly probePort: TcpPortProbe;
  readonly sessionCheck?:
    ((sessionPath: string) => Promise<boolean>) | undefined;
}): Promise<{ readonly kind: string; readonly reason: string } | null> {
  const { proc } = options;
  const hay = `${proc.command} ${proc.args}`;

  if (
    hay.includes("temporal-test-server") ||
    hay.includes("temporal-test-server-sdk-")
  ) {
    return {
      kind: "temporal-test-server",
      reason: `orphaned temporal-test-server (PPID=${String(proc.ppid)}, age ${formatDurationCompact(proc.elapsedSeconds * 1000)})`,
    };
  }

  if (
    hay.includes("scripts/media-system/workflow-worker.ts") ||
    hay.includes(String.raw`scripts\media-system\workflow-worker.ts`)
  ) {
    return {
      kind: "media-workflow-worker",
      reason: `orphaned media workflow worker (PPID=${String(proc.ppid)}, age ${formatDurationCompact(proc.elapsedSeconds * 1000)})`,
    };
  }

  const stormSession = parseStormSessionPath(proc.args);
  if (stormSession !== null && !options.mcDaemonLive) {
    const checkFn = options.sessionCheck ?? stormSessionAlive;
    if (!(await checkFn(stormSession))) {
      return {
        kind: "storm-client-jvm",
        reason: `orphaned Minecraft client JVM (missing session ${stormSession}, no live mc-harness daemon)`,
      };
    }
  }

  if (
    hay.includes("kubectl") &&
    hay.includes("port-forward") &&
    hay.includes("mc-sandbox") &&
    !options.mcDaemonLive
  ) {
    return {
      kind: "kubectl-port-forward",
      reason:
        "orphaned kubectl port-forward for mc-sandbox with no live mc-harness daemon",
    };
  }

  const tunnelPort = parseCloudflaredQuickTunnelPort(hay);
  if (tunnelPort !== null) {
    const targetReachable = await options.probePort("127.0.0.1", tunnelPort);
    if (!targetReachable) {
      return {
        kind: "cloudflared-quick-tunnel",
        reason: `orphaned cloudflared quick tunnel to unreachable 127.0.0.1:${String(tunnelPort)}`,
      };
    }
  }

  return null;
}

function trySendSignal(
  pid: number,
  signal: "SIGTERM" | "SIGKILL",
  signaler: ProcessSignaler,
): { readonly ok: boolean; readonly detail?: string | undefined } {
  try {
    signaler.kill(pid, signal);
    return { ok: true };
  } catch (error: unknown) {
    if (!signaler.isAlive(pid)) {
      return { ok: true };
    }
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForExit(
  pid: number,
  signaler: ProcessSignaler,
): Promise<boolean> {
  for (let step = 0; step < 10; step += 1) {
    if (!signaler.isAlive(pid)) {
      return true;
    }
    await signaler.sleep(200);
  }
  return !signaler.isAlive(pid);
}

async function terminateVerifiedProcess(
  proc: OsProcessEntry,
  signaler: ProcessSignaler,
): Promise<{ readonly ok: boolean; readonly detail?: string | undefined }> {
  const currentStart = await signaler.readStart(proc.pid);
  if (currentStart === undefined) {
    return { ok: true, detail: "already exited" };
  }
  if (!processStartsMatch(currentStart, proc.processStart)) {
    return {
      ok: false,
      detail: `refused signal: pid ${String(proc.pid)} start time changed`,
    };
  }

  const termOutcome = trySendSignal(proc.pid, "SIGTERM", signaler);
  if (!termOutcome.ok || (await waitForExit(proc.pid, signaler))) {
    return termOutcome;
  }

  const recheckStart = await signaler.readStart(proc.pid);
  return recheckStart !== undefined &&
    processStartsMatch(recheckStart, proc.processStart)
    ? trySendSignal(proc.pid, "SIGKILL", signaler)
    : { ok: true };
}

function isEligibleOrphanProcess(options: {
  readonly proc: OsProcessEntry;
  readonly liveness: LivenessSnapshot;
  readonly minAgeSeconds: number;
  readonly leaseProtectedPids: ReadonlySet<number>;
}): boolean {
  const { proc, liveness } = options;
  if (proc.pid === process.pid || proc.pid === process.ppid) {
    return false;
  }
  if (!isOrphanParent(proc, liveness.processes, liveness.platform)) {
    return false;
  }
  if (proc.elapsedSeconds < options.minAgeSeconds) {
    return false;
  }
  const protectedBySession =
    options.leaseProtectedPids.has(proc.pid) ||
    liveness.liveTerminalRelatedPids.has(proc.pid);
  return (
    !protectedBySession &&
    !(
      proc.cwd !== undefined &&
      (isUnderProtectedPrefix(
        proc.cwd,
        liveness.forumNoticePaths,
        liveness.platform,
      ) ||
        isPathProtected(proc.cwd, liveness.forumNoticePaths, liveness.platform))
    )
  );
}

export type SweepProcessesOptions = {
  readonly liveness: LivenessSnapshot;
  readonly leases?: readonly ClassifiedLease[] | undefined;
  readonly runner?: CommandRunner | undefined;
  readonly probePort?: TcpPortProbe | undefined;
  readonly signaler?: ProcessSignaler | undefined;
  readonly stormSessionCheck?: ((path: string) => Promise<boolean>) | undefined;
  readonly minAgeSeconds?: number | undefined;
  readonly apply: boolean;
};

export async function sweepProcesses(
  options: SweepProcessesOptions,
): Promise<SurfaceSweepResult> {
  const heldReason = options.liveness.holdSurfaces.get("processes");
  if (heldReason !== undefined) {
    return {
      surface: "processes",
      heldReason,
      inspectedCount: 0,
      candidates: [],
      actions: [],
      warnings: [],
    };
  }

  const runner = options.runner ?? defaultCommandRunner;
  const probePort = options.probePort ?? defaultTcpPortProbe;
  const signaler =
    options.signaler ??
    createDefaultSignaler(runner, options.liveness.platform);
  const minAgeSeconds = options.minAgeSeconds ?? ORPHAN_PROCESS_MIN_AGE_SECONDS;
  const leaseProtectedPids = collectLeaseProtectedPids(options.leases ?? []);
  const mcDaemonLive = hasLiveMcHarnessDaemon(options.liveness.processes);

  const candidates: TendCandidate[] = [];
  const actions: TendActionOutcome[] = [];
  let inspectedCount = 0;

  const sortedPids = [...options.liveness.processes.keys()].sort(
    (a, b) => a - b,
  );

  for (const pid of sortedPids) {
    const proc = options.liveness.processes.get(pid);
    if (proc === undefined) {
      continue;
    }
    inspectedCount += 1;
    if (
      !isEligibleOrphanProcess({
        proc,
        liveness: options.liveness,
        minAgeSeconds,
        leaseProtectedPids,
      })
    ) {
      continue;
    }

    const match = await classifyOrphanProcess({
      proc,
      mcDaemonLive,
      probePort,
      sessionCheck: options.stormSessionCheck,
    });
    if (match === null) {
      continue;
    }

    const candidate: TendCandidate = {
      id: `proc:${String(proc.pid)}`,
      surface: "processes",
      kind: match.kind,
      target: `pid:${String(proc.pid)} (${proc.command})`,
      reason: match.reason,
      ageSeconds: proc.elapsedSeconds,
      metadata: {
        pid: proc.pid,
        ppid: proc.ppid,
      },
    };
    candidates.push(candidate);

    if (!options.apply) {
      actions.push({ candidate, status: "planned" });
      continue;
    }
    const result = await terminateVerifiedProcess(proc, signaler);
    actions.push({
      candidate,
      status: result.ok ? "removed" : "failed",
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    });
  }

  return {
    surface: "processes",
    inspectedCount,
    candidates,
    actions,
    warnings: [],
  };
}
