import { readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  canonicalizeExistingPath,
  formatDurationCompact,
  isPathProtected,
  isUnderProtectedPrefix,
} from "./paths.ts";
import {
  createPsqlSharedAdapter,
  isOwnerDeadOnThisHost,
  parseClusterOwnerPidFile,
  type SharedPostgresAdapter,
  sweepSharedPostgresDatabases,
} from "./postgres-databases.ts";
import { defaultCommandRunner, defaultTcpPortProbe } from "./process-probe.ts";
import type {
  CommandRunner,
  LivenessSnapshot,
  OsProcessEntry,
  SurfaceSweepResult,
  TcpPortProbe,
  TendActionOutcome,
  TendCandidate,
} from "./types.ts";

const CLUSTER_NAME_PATTERN = /^(?:(?:delivery|media|tracker)-pg-|.*-pgstage-)/u;
const ORPHAN_POSTMASTER_MIN_AGE_SECONDS = 30 * 60;
const UNOWNED_CLUSTER_MIN_AGE_MS = 30 * 60 * 1000;
const SHARED_DEV_PG_PORT = 5471;

function isPostgresServerProcess(
  proc: OsProcessEntry,
  postmasterPid: number | undefined,
): boolean {
  if (
    postmasterPid !== undefined &&
    (proc.pid === postmasterPid || proc.ppid === postmasterPid)
  ) {
    return true;
  }
  const argv0 = proc.args.trim().split(/\s+/u)[0] ?? proc.command;
  const lower = argv0.toLowerCase();
  return (
    argv0 === "postgres" ||
    argv0 === "postgres:" ||
    argv0.endsWith("/postgres") ||
    lower === "postgres.exe" ||
    lower.endsWith(String.raw`\postgres.exe`) ||
    lower.endsWith("/postgres.exe")
  );
}

function isClusterHeldExternally(
  canonicalClusterDir: string,
  liveness: LivenessSnapshot,
  postmasterPid: number | undefined,
): boolean {
  if (
    isUnderProtectedPrefix(
      canonicalClusterDir,
      liveness.forumNoticePaths,
      liveness.platform,
    ) ||
    isPathProtected(
      canonicalClusterDir,
      liveness.forumNoticePaths,
      liveness.platform,
    ) ||
    isPathProtected(
      canonicalClusterDir,
      liveness.herdrActivePaths,
      liveness.platform,
    )
  ) {
    return true;
  }
  const terminalPaths = new Set<string>();
  for (const term of liveness.hcTerminals) {
    if (term.cwd.length > 0) terminalPaths.add(term.cwd);
    if (term.foregroundCwd !== undefined && term.foregroundCwd.length > 0) {
      terminalPaths.add(term.foregroundCwd);
    }
  }
  if (isPathProtected(canonicalClusterDir, terminalPaths, liveness.platform)) {
    return true;
  }
  const nonPostgresCwds = new Set<string>();
  for (const proc of liveness.processes.values()) {
    if (
      proc.cwd !== undefined &&
      proc.cwd.length > 0 &&
      !isPostgresServerProcess(proc, postmasterPid)
    ) {
      nonPostgresCwds.add(proc.cwd);
    }
  }
  return isPathProtected(
    canonicalClusterDir,
    nonPostgresCwds,
    liveness.platform,
  );
}

type PostmasterInfo = {
  readonly dataDir: string;
  readonly pid: number;
  readonly port?: number | undefined;
};

async function readPostmasterInfo(
  clusterDir: string,
): Promise<PostmasterInfo | null> {
  const candidateDataDirs = [path.join(clusterDir, "data"), clusterDir];
  for (const dataDir of candidateDataDirs) {
    const pidFile = Bun.file(path.join(dataDir, "postmaster.pid"));
    if (!(await pidFile.exists())) {
      continue;
    }
    try {
      const content = await pidFile.text();
      const lines = content.split(/\r?\n/u);
      const pid = Number(lines[0]?.trim() ?? "");
      const portRaw = Number(lines[3]?.trim() ?? "");
      if (Number.isInteger(pid) && pid > 0) {
        return {
          dataDir,
          pid,
          ...(Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65_535
            ? { port: portRaw }
            : {}),
        };
      }
    } catch {
      // Ignore unreadable postmaster.pid.
    }
  }
  return null;
}

async function resolveDataDirForStop(
  clusterDir: string,
): Promise<string | null> {
  for (const candidate of [path.join(clusterDir, "data"), clusterDir]) {
    if (
      (await Bun.file(path.join(candidate, "PG_VERSION")).exists()) ||
      (await Bun.file(path.join(candidate, "postmaster.pid")).exists())
    ) {
      return candidate;
    }
  }
  return null;
}

function postmasterBinExecutable(
  args: string | undefined,
  binary: string,
): string {
  if (args === undefined) {
    return binary;
  }
  const firstToken = args.trim().split(/\s+/u)[0] ?? "";
  return firstToken.startsWith("/") && firstToken.endsWith("/postgres")
    ? path.join(path.dirname(firstToken), binary)
    : binary;
}

function collectProbeUsers(): string[] {
  const users = new Set<string>();
  try {
    const username = os.userInfo().username;
    if (username.length > 0) {
      users.add(username);
    }
  } catch {
    // Ignore unavailable OS user info.
  }
  for (const role of ["media", "tracker", "delivery", "postgres", "scout"]) {
    users.add(role);
  }
  return [...users];
}

async function probeClusterClientConnections(
  port: number | undefined,
  psqlBin: string,
  runner: CommandRunner,
): Promise<number | null> {
  if (port === undefined) {
    return 0;
  }
  const sql =
    "SELECT count(*)::int FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND backend_type = 'client backend'";
  for (const user of collectProbeUsers()) {
    const res = await runner(
      [
        psqlBin,
        "--no-psqlrc",
        "-X",
        "-A",
        "-t",
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-U",
        user,
        "-d",
        "postgres",
        "-c",
        sql,
      ],
      { timeoutMs: 2000 },
    );
    const trimmed = res.stdout.trim();
    if (res.exitCode === 0 && /^\d+$/u.test(trimmed)) {
      return Number(trimmed);
    }
  }
  return null;
}

async function checkClusterOwnerFile(
  clusterDir: string,
  liveness: LivenessSnapshot,
): Promise<{ readonly present: boolean; readonly deadReason: string | null }> {
  const ownerFile = Bun.file(path.join(clusterDir, "owner.pid"));
  if (!(await ownerFile.exists())) {
    return { present: false, deadReason: null };
  }
  let text: string;
  try {
    text = await ownerFile.text();
  } catch {
    return { present: false, deadReason: null };
  }
  const parsedOwner = parseClusterOwnerPidFile(text);
  if (parsedOwner === null) {
    return { present: false, deadReason: null };
  }
  const check = isOwnerDeadOnThisHost(parsedOwner, liveness.processes);
  return { present: true, deadReason: check.dead ? check.reason : null };
}

async function evaluateClusterDirectory(options: {
  readonly clusterDir: string;
  readonly mtimeMs: number;
  readonly nowMs: number;
  readonly liveness: LivenessSnapshot;
  readonly runner: CommandRunner;
}): Promise<string | null> {
  const ownerState = await checkClusterOwnerFile(
    options.clusterDir,
    options.liveness,
  );
  if (ownerState.present) {
    return ownerState.deadReason;
  }

  const ageMs = Math.max(0, options.nowMs - options.mtimeMs);
  const postmaster = await readPostmasterInfo(options.clusterDir);
  if (postmaster === null) {
    return ageMs >= UNOWNED_CLUSTER_MIN_AGE_MS
      ? `no owner.pid or postmaster.pid (idle ${formatDurationCompact(ageMs)})`
      : null;
  }

  const livePostmaster = options.liveness.processes.get(postmaster.pid);
  if (livePostmaster === undefined) {
    return `postmaster pid ${String(postmaster.pid)} is dead`;
  }

  if (
    livePostmaster.ppid === 1 &&
    livePostmaster.elapsedSeconds >= ORPHAN_POSTMASTER_MIN_AGE_SECONDS
  ) {
    const psqlBin = postmasterBinExecutable(livePostmaster.args, "psql");
    const clients = await probeClusterClientConnections(
      postmaster.port,
      psqlBin,
      options.runner,
    );
    if (clients === 0) {
      return `orphaned postmaster pid ${String(postmaster.pid)} (PPID=1, age ${formatDurationCompact(livePostmaster.elapsedSeconds * 1000)}, 0 connections)`;
    }
  }
  return null;
}

async function discoverTempRoots(
  explicitDirs: readonly string[] | undefined,
  platform: NodeJS.Platform,
): Promise<string[]> {
  const rawDirs =
    explicitDirs ??
    (platform === "darwin"
      ? [os.tmpdir(), "/tmp", "/private/tmp"]
      : [os.tmpdir()]);
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const dir of rawDirs) {
    const canonical = await canonicalizeExistingPath(dir, platform);
    if (canonical.length === 0 || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    roots.push(dir);
  }
  return roots;
}

async function removeClusterDirectory(
  clusterDir: string,
  candidate: TendCandidate,
  liveness: LivenessSnapshot,
  runner: CommandRunner,
): Promise<TendActionOutcome> {
  const postmaster = await readPostmasterInfo(clusterDir);
  const livePostmaster =
    postmaster === null ? undefined : liveness.processes.get(postmaster.pid);
  const pgCtlBin = postmasterBinExecutable(livePostmaster?.args, "pg_ctl");
  const dataDir = await resolveDataDirForStop(clusterDir);
  if (dataDir !== null) {
    await runner([pgCtlBin, "-D", dataDir, "-m", "immediate", "-w", "stop"], {
      timeoutMs: 8000,
    });
  }
  if (postmaster !== null && livePostmaster !== undefined) {
    try {
      process.kill(postmaster.pid, "SIGTERM");
    } catch {
      // Already exited via pg_ctl stop.
    }
  }
  try {
    await rm(clusterDir, { recursive: true, force: true });
    return { candidate, status: "removed" };
  } catch (error: unknown) {
    return {
      candidate,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function statClusterDirMtime(clusterDir: string): Promise<number | null> {
  try {
    const info = await stat(clusterDir);
    return info.isDirectory() ? info.mtimeMs : null;
  } catch {
    return null;
  }
}

async function sweepSingleTempRootClusters(options: {
  readonly rootDir: string;
  readonly liveness: LivenessSnapshot;
  readonly runner: CommandRunner;
  readonly apply: boolean;
  readonly nowMs: number;
  readonly candidates: TendCandidate[];
  readonly actions: TendActionOutcome[];
}): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(options.rootDir);
  } catch {
    return 0;
  }
  let inspected = 0;
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    if (!CLUSTER_NAME_PATTERN.test(name)) {
      continue;
    }
    const clusterDir = path.join(options.rootDir, name);
    const mtimeMs = await statClusterDirMtime(clusterDir);
    if (mtimeMs === null) {
      continue;
    }
    inspected += 1;
    const canonical = await canonicalizeExistingPath(
      clusterDir,
      options.liveness.platform,
    );
    const postmaster = await readPostmasterInfo(clusterDir);
    if (isClusterHeldExternally(canonical, options.liveness, postmaster?.pid)) {
      continue;
    }
    const reason = await evaluateClusterDirectory({
      clusterDir,
      mtimeMs,
      nowMs: options.nowMs,
      liveness: options.liveness,
      runner: options.runner,
    });
    if (reason === null) {
      continue;
    }
    const candidate: TendCandidate = {
      id: `pg-cluster:${canonical}`,
      surface: "postgres",
      kind: "temp-cluster",
      target: clusterDir,
      reason,
      ageSeconds: Math.max(0, Math.floor((options.nowMs - mtimeMs) / 1000)),
    };
    options.candidates.push(candidate);
    options.actions.push(
      options.apply
        ? await removeClusterDirectory(
            clusterDir,
            candidate,
            options.liveness,
            options.runner,
          )
        : { candidate, status: "planned" },
    );
  }
  return inspected;
}

export type SweepPostgresOptions = {
  readonly liveness: LivenessSnapshot;
  readonly runner?: CommandRunner | undefined;
  readonly probePort?: TcpPortProbe | undefined;
  readonly sharedAdapter?: SharedPostgresAdapter | undefined;
  readonly sharedPort?: number | undefined;
  readonly tempDirs?: readonly string[] | undefined;
  readonly apply: boolean;
  readonly nowMs?: number | undefined;
};

export async function sweepPostgres(
  options: SweepPostgresOptions,
): Promise<SurfaceSweepResult> {
  const heldReason = options.liveness.holdSurfaces.get("postgres");
  if (heldReason !== undefined) {
    return {
      surface: "postgres",
      heldReason,
      inspectedCount: 0,
      candidates: [],
      actions: [],
      warnings: [],
    };
  }

  const runner = options.runner ?? defaultCommandRunner;
  const probePort = options.probePort ?? defaultTcpPortProbe;
  const sharedPort = options.sharedPort ?? SHARED_DEV_PG_PORT;
  const nowMs = options.nowMs ?? Date.now();
  const roots = await discoverTempRoots(
    options.tempDirs,
    options.liveness.platform,
  );

  let inspectedCount = 0;
  const candidates: TendCandidate[] = [];
  const actions: TendActionOutcome[] = [];
  const warnings: string[] = [];

  for (const rootDir of roots) {
    inspectedCount += await sweepSingleTempRootClusters({
      rootDir,
      liveness: options.liveness,
      runner,
      apply: options.apply,
      nowMs,
      candidates,
      actions,
    });
  }

  const isListening =
    options.sharedAdapter !== undefined ||
    (await probePort("127.0.0.1", sharedPort));

  if (isListening) {
    const adapter =
      options.sharedAdapter ?? createPsqlSharedAdapter(sharedPort, runner);
    inspectedCount += await sweepSharedPostgresDatabases({
      adapter,
      sharedPort,
      liveness: options.liveness,
      apply: options.apply,
      nowMs,
      candidates,
      actions,
      warnings,
    });
  }

  return {
    surface: "postgres",
    inspectedCount,
    candidates,
    actions,
    warnings,
  };
}
