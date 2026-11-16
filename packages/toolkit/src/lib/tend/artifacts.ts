import { rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  canonicalizeExistingPath,
  formatDurationCompact,
  isPathProtected,
  isUnderProtectedPrefix,
  normalizeHostPath,
  readSortedNames,
  statDirectoryMtime,
} from "./paths.ts";
import {
  isOwnerDeadOnThisHost,
  parseClusterOwnerPidFile,
} from "./postgres-databases.ts";
import { defaultCommandRunner } from "./process-probe.ts";
import { hasLiveMcHarnessDaemon } from "./processes.ts";
import type {
  ClassifiedLease,
  CommandRunner,
  LivenessSnapshot,
  OsProcessEntry,
  SurfaceSweepResult,
  TendActionOutcome,
  TendCandidate,
} from "./types.ts";

const PRISM_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const SIMULATOR_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const BRIM_INSTALL_MIN_AGE_MS = 60 * 60 * 1000;
const BRIM_INSTALL_KEEP_NEWEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MC_ARTIFACT_MIN_AGE_MS = 72 * 60 * 60 * 1000;
const TEMP_ARTIFACT_MIN_AGE_MS = 6 * 60 * 60 * 1000;
const PRISM_INSTANCE_PATTERN = /^storm-(?:capture|control)-/u;
const MC_SUBDIRS = ["runs", "clients", "suites", "reviews", "evals"] as const;
const TEMP_DIR_PATTERN =
  /^(?:mc-client-|storm-client-|e2e-goal-|tasknotes-e2e-|scout-temporal-)/u;

const SimctlDeviceSchema = z.looseObject({
  udid: z.string().min(1),
  name: z.string(),
  state: z.string(),
  lastBootedAt: z.string().optional(),
});
const SimctlListSchema = z.looseObject({
  devices: z.record(z.string(), z.array(SimctlDeviceSchema)).optional(),
});
type SimctlDevice = z.infer<typeof SimctlDeviceSchema>;

type FsRemovalCollector = {
  inspected: number;
  readonly candidates: TendCandidate[];
  readonly actions: TendActionOutcome[];
  readonly apply: boolean;
};

type ArtifactSweepContext = {
  readonly homeDir: string;
  readonly tempDirs: readonly string[] | undefined;
  readonly liveness: LivenessSnapshot;
  readonly protectedPaths: ReadonlySet<string>;
  readonly runner: CommandRunner;
  readonly nowMs: number;
  readonly collector: FsRemovalCollector;
};

function isArtifactPathHeld(
  targetPath: string,
  ctx: ArtifactSweepContext,
): boolean {
  return (
    isPathProtected(targetPath, ctx.protectedPaths, ctx.liveness.platform) ||
    isUnderProtectedPrefix(
      targetPath,
      ctx.liveness.forumNoticePaths,
      ctx.liveness.platform,
    )
  );
}

function buildProtectedSet(
  liveness: LivenessSnapshot,
  leases: readonly ClassifiedLease[],
): Set<string> {
  const set = new Set<string>(liveness.protectedPaths);
  for (const item of leases) {
    if (item.status === "active" && item.lease.kind === "dir") {
      set.add(normalizeHostPath(item.lease.target, liveness.platform));
    }
  }
  return set;
}

function hasLiveStormJvm(
  liveness: LivenessSnapshot,
  instancePath: string,
): boolean {
  for (const proc of liveness.processes.values()) {
    if (
      proc.args.includes("-Dstorm.client.session=") ||
      proc.args.includes(instancePath)
    ) {
      return true;
    }
  }
  return false;
}

async function recordFsCandidate(
  collector: FsRemovalCollector,
  candidate: TendCandidate,
): Promise<void> {
  collector.candidates.push(candidate);
  if (!collector.apply) {
    collector.actions.push({ candidate, status: "planned" });
    return;
  }
  try {
    await rm(candidate.target, { recursive: true, force: true });
    collector.actions.push({ candidate, status: "removed" });
  } catch (error: unknown) {
    collector.actions.push({
      candidate,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function sweepPrismInstances(ctx: ArtifactSweepContext): Promise<void> {
  if (
    ctx.liveness.platform !== "darwin" ||
    hasLiveMcHarnessDaemon(ctx.liveness.processes)
  ) {
    return;
  }
  const instancesDir = path.join(
    ctx.homeDir,
    "Library",
    "Application Support",
    "PrismLauncher",
    "instances",
  );
  for (const name of await readSortedNames(instancesDir)) {
    if (!PRISM_INSTANCE_PATTERN.test(name)) {
      continue;
    }
    const target = path.join(instancesDir, name);
    const mtimeMs = await statDirectoryMtime(target);
    if (mtimeMs === null) {
      continue;
    }
    ctx.collector.inspected += 1;
    const ageMs = Math.max(0, ctx.nowMs - mtimeMs);
    if (
      ageMs < PRISM_MIN_AGE_MS ||
      isArtifactPathHeld(target, ctx) ||
      hasLiveStormJvm(ctx.liveness, target)
    ) {
      continue;
    }
    await recordFsCandidate(ctx.collector, {
      id: `prism:${target}`,
      surface: "artifacts",
      kind: "prism-instance",
      target,
      reason: `dead-session Prism instance older than 2h (${formatDurationCompact(ageMs)})`,
      ageSeconds: Math.floor(ageMs / 1000),
    });
  }
}

async function resolveSimulatorLastTouchMs(
  device: SimctlDevice,
  homeDir: string,
): Promise<number> {
  const parsedBoot =
    device.lastBootedAt === undefined ? 0 : Date.parse(device.lastBootedAt);
  const lastTouchMs = Number.isNaN(parsedBoot) ? 0 : parsedBoot;
  const deviceDir = path.join(
    homeDir,
    "Library",
    "Developer",
    "CoreSimulator",
    "Devices",
    device.udid,
  );
  const dirMtime = await statDirectoryMtime(deviceDir);
  return dirMtime === null ? lastTouchMs : Math.max(lastTouchMs, dirMtime);
}

function parseSimctlDevices(stdout: string): SimctlDevice[] {
  try {
    const parsed = SimctlListSchema.safeParse(JSON.parse(stdout));
    return parsed.success
      ? Object.values(parsed.data.devices ?? {}).flat()
      : [];
  } catch {
    return [];
  }
}

async function evaluateFacetSimulator(
  device: SimctlDevice,
  ctx: ArtifactSweepContext,
): Promise<void> {
  if (!device.name.startsWith("Facet E2E ")) {
    return;
  }
  ctx.collector.inspected += 1;
  if (device.state !== "Shutdown") {
    return;
  }
  const lastTouchMs = await resolveSimulatorLastTouchMs(device, ctx.homeDir);
  const ageMs = lastTouchMs === 0 ? 0 : Math.max(0, ctx.nowMs - lastTouchMs);
  if (lastTouchMs === 0 || ageMs < SIMULATOR_MIN_AGE_MS) {
    return;
  }
  const candidate: TendCandidate = {
    id: `simctl:${device.udid}`,
    surface: "artifacts",
    kind: "coresimulator-device",
    target: `${device.name} (${device.udid})`,
    reason: `Shutdown Facet E2E simulator older than 2h (${formatDurationCompact(ageMs)})`,
    ageSeconds: Math.floor(ageMs / 1000),
  };
  ctx.collector.candidates.push(candidate);
  if (!ctx.collector.apply) {
    ctx.collector.actions.push({ candidate, status: "planned" });
    return;
  }
  const delRes = await ctx.runner(["xcrun", "simctl", "delete", device.udid], {
    timeoutMs: 10_000,
  });
  ctx.collector.actions.push({
    candidate,
    status: delRes.exitCode === 0 ? "removed" : "failed",
    ...(delRes.exitCode === 0 ? {} : { detail: delRes.stderr.trim() }),
  });
}

async function sweepCoreSimulators(ctx: ArtifactSweepContext): Promise<void> {
  if (ctx.liveness.platform !== "darwin") {
    return;
  }
  const listRes = await ctx.runner(
    ["xcrun", "simctl", "list", "devices", "-j"],
    { timeoutMs: 6000 },
  );
  if (listRes.exitCode !== 0 || listRes.stdout.trim().length === 0) {
    return;
  }
  for (const device of parseSimctlDevices(listRes.stdout)) {
    await evaluateFacetSimulator(device, ctx);
  }
}

async function sweepBrimInstallArtifacts(
  ctx: ArtifactSweepContext,
): Promise<void> {
  const toolkitRoot = path.join(ctx.homeDir, ".toolkit");
  const entries: { readonly path: string; readonly mtimeMs: number }[] = [];
  for (const name of await readSortedNames(toolkitRoot)) {
    if (!name.startsWith("brim-install-")) {
      continue;
    }
    const full = path.join(toolkitRoot, name);
    try {
      const info = await stat(full);
      entries.push({ path: full, mtimeMs: info.mtimeMs });
    } catch {
      // Ignore vanished file.
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  ctx.collector.inspected += entries.length;
  for (const [index, entry] of entries.entries()) {
    const ageMs = Math.max(0, ctx.nowMs - entry.mtimeMs);
    const keepNewest =
      index === 0 && ageMs < BRIM_INSTALL_KEEP_NEWEST_MAX_AGE_MS;
    if (
      keepNewest ||
      ageMs < BRIM_INSTALL_MIN_AGE_MS ||
      isArtifactPathHeld(entry.path, ctx)
    ) {
      continue;
    }
    await recordFsCandidate(ctx.collector, {
      id: `brim-install:${entry.path}`,
      surface: "artifacts",
      kind: "brim-install",
      target: entry.path,
      reason: `stale brim-install artifact (${formatDurationCompact(ageMs)} old)`,
      ageSeconds: Math.floor(ageMs / 1000),
    });
  }
}

async function sweepMcArtifacts(ctx: ArtifactSweepContext): Promise<void> {
  const mcRoot = path.join(ctx.homeDir, ".toolkit", "mc");
  for (const sub of MC_SUBDIRS) {
    const dir = path.join(mcRoot, sub);
    for (const name of await readSortedNames(dir)) {
      const target = path.join(dir, name);
      const mtimeMs = await statDirectoryMtime(target);
      if (mtimeMs === null) {
        continue;
      }
      ctx.collector.inspected += 1;
      const ageMs = Math.max(0, ctx.nowMs - mtimeMs);
      if (ageMs < MC_ARTIFACT_MIN_AGE_MS || isArtifactPathHeld(target, ctx)) {
        continue;
      }
      await recordFsCandidate(ctx.collector, {
        id: `mc-${sub}:${target}`,
        surface: "artifacts",
        kind: `mc-${sub}`,
        target,
        reason: `aged ~/.toolkit/mc/${sub} directory (${formatDurationCompact(ageMs)} old)`,
        ageSeconds: Math.floor(ageMs / 1000),
      });
    }
  }
}

async function hasLiveOwnerPidInDir(
  dirPath: string,
  processes: ReadonlyMap<number, OsProcessEntry>,
): Promise<boolean> {
  const ownerFile = Bun.file(path.join(dirPath, "owner.pid"));
  if (!(await ownerFile.exists())) {
    return false;
  }
  let rawText: string;
  try {
    rawText = await ownerFile.text();
  } catch {
    return false;
  }
  const parsedOwner = parseClusterOwnerPidFile(rawText);
  return (
    parsedOwner !== null && !isOwnerDeadOnThisHost(parsedOwner, processes).dead
  );
}

async function sweepSingleTempRoot(
  rootDir: string,
  ctx: ArtifactSweepContext,
): Promise<void> {
  for (const name of await readSortedNames(rootDir)) {
    if (!TEMP_DIR_PATTERN.test(name)) {
      continue;
    }
    const target = path.join(rootDir, name);
    const mtimeMs = await statDirectoryMtime(target);
    if (mtimeMs === null) {
      continue;
    }
    ctx.collector.inspected += 1;
    const ageMs = Math.max(0, ctx.nowMs - mtimeMs);
    if (ageMs < TEMP_ARTIFACT_MIN_AGE_MS) {
      continue;
    }
    const canonicalTarget = await canonicalizeExistingPath(
      target,
      ctx.liveness.platform,
    );
    if (
      isArtifactPathHeld(canonicalTarget, ctx) ||
      (await hasLiveOwnerPidInDir(target, ctx.liveness.processes))
    ) {
      continue;
    }
    await recordFsCandidate(ctx.collector, {
      id: `tmp-artifact:${canonicalTarget}`,
      surface: "artifacts",
      kind: "temp-dir",
      target,
      reason: `stale temp directory (${formatDurationCompact(ageMs)} old)`,
      ageSeconds: Math.floor(ageMs / 1000),
    });
  }
}

async function sweepTempDirectories(ctx: ArtifactSweepContext): Promise<void> {
  const rawRoots =
    ctx.tempDirs ??
    (ctx.liveness.platform === "darwin"
      ? [os.tmpdir(), "/tmp", "/private/tmp"]
      : [os.tmpdir()]);
  const seenRoots = new Set<string>();
  for (const rootDir of rawRoots) {
    const canonicalRoot = await canonicalizeExistingPath(
      rootDir,
      ctx.liveness.platform,
    );
    if (canonicalRoot.length === 0 || seenRoots.has(canonicalRoot)) {
      continue;
    }
    seenRoots.add(canonicalRoot);
    await sweepSingleTempRoot(rootDir, ctx);
  }
}

export type SweepArtifactsOptions = {
  readonly liveness: LivenessSnapshot;
  readonly leases?: readonly ClassifiedLease[] | undefined;
  readonly runner?: CommandRunner | undefined;
  readonly homeDir?: string | undefined;
  readonly tempDirs?: readonly string[] | undefined;
  readonly apply: boolean;
  readonly nowMs?: number | undefined;
};

export async function sweepArtifacts(
  options: SweepArtifactsOptions,
): Promise<SurfaceSweepResult> {
  const heldReason = options.liveness.holdSurfaces.get("artifacts");
  if (heldReason !== undefined) {
    return {
      surface: "artifacts",
      heldReason,
      inspectedCount: 0,
      candidates: [],
      actions: [],
      warnings: [],
    };
  }
  const collector: FsRemovalCollector = {
    inspected: 0,
    candidates: [],
    actions: [],
    apply: options.apply,
  };
  const ctx: ArtifactSweepContext = {
    homeDir: options.homeDir ?? Bun.env["HOME"] ?? os.homedir(),
    tempDirs: options.tempDirs,
    liveness: options.liveness,
    protectedPaths: buildProtectedSet(options.liveness, options.leases ?? []),
    runner: options.runner ?? defaultCommandRunner,
    nowMs: options.nowMs ?? Date.now(),
    collector,
  };
  await sweepPrismInstances(ctx);
  await sweepCoreSimulators(ctx);
  await sweepBrimInstallArtifacts(ctx);
  await sweepMcArtifacts(ctx);
  await sweepTempDirectories(ctx);
  return {
    surface: "artifacts",
    inspectedCount: collector.inspected,
    candidates: collector.candidates,
    actions: collector.actions,
    warnings: [],
  };
}
