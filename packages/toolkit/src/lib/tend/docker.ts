import { formatDurationCompact } from "./paths.ts";
import { defaultCommandRunner } from "./process-probe.ts";
import { hasLiveMcHarnessDaemon } from "./processes.ts";
import type {
  ClassifiedLease,
  CommandRunner,
  LivenessSnapshot,
  SurfaceSweepResult,
  TendActionOutcome,
  TendCandidate,
} from "./types.ts";

const MC_ORPHAN_CONTAINER_MIN_AGE_MS = 2 * 60 * 60 * 1000;

export const DOCKER_CONTAINER_PRUNE_ARGV = [
  "docker",
  "container",
  "prune",
  "-f",
  "--filter",
  "until=1h",
] as const;

/**
 * Anonymous/dangling volumes ONLY. Never pass `--all` or `-a` so user-named
 * volumes are 100% preserved in Docker >=23.
 */
export const DOCKER_VOLUME_PRUNE_ARGV = [
  "docker",
  "volume",
  "prune",
  "-f",
] as const;

export const DOCKER_IMAGE_PRUNE_ARGV = [
  "docker",
  "image",
  "prune",
  "-a",
  "-f",
  "--filter",
  "until=168h",
] as const;

export const DOCKER_BUILDER_PRUNE_ARGV = [
  "docker",
  "builder",
  "prune",
  "-f",
  "--keep-storage=25GB",
] as const;

const MC_MANAGED_PS_FORMAT =
  '{{.ID}}\t{{.Names}}\t{{.CreatedAt}}\t{{.Label "mc-harness.expires-at"}}\t{{.Label "mc-harness.daemon-pid"}}\t{{.Label "mc-harness.keep"}}';

export type ManagedMcContainerRow = {
  readonly id: string;
  readonly name: string;
  readonly createdAtRaw: string;
  readonly expiresAtRaw: string;
  readonly daemonPidRaw: string;
  readonly keep: boolean;
};

export function parseManagedMcContainers(
  stdout: string,
): ManagedMcContainerRow[] {
  const rows: ManagedMcContainerRow[] = [];
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const [
      id = "",
      name = "",
      createdAtRaw = "",
      expiresAtRaw = "",
      daemonPidRaw = "",
      keepRaw = "",
    ] = rawLine.split("\t");
    if (id.trim().length === 0) {
      continue;
    }
    rows.push({
      id: id.trim(),
      name: name.trim(),
      createdAtRaw: createdAtRaw.trim(),
      expiresAtRaw: expiresAtRaw.trim(),
      daemonPidRaw: daemonPidRaw.trim(),
      keep: keepRaw.trim().toLowerCase() === "true",
    });
  }
  return rows;
}

function parseFlexibleTimestampMs(raw: string): number | null {
  if (raw.length === 0) {
    return null;
  }
  if (/^\d+$/u.test(raw)) {
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) {
      return null;
    }
    return raw.length <= 10 ? num * 1000 : num;
  }
  // Docker CreatedAt often looks like `2026-11-15 12:00:00 -0800 PST`
  const withoutZoneName = raw.replace(/\s+[A-Z]{2,5}$/u, "");
  const parsed = Date.parse(withoutZoneName);
  return Number.isNaN(parsed) ? null : parsed;
}

function evaluateManagedMcContainer(options: {
  readonly row: ManagedMcContainerRow;
  readonly nowMs: number;
  readonly liveness: LivenessSnapshot;
  readonly mcDaemonLive: boolean;
  readonly leasedTargets: ReadonlySet<string>;
}): {
  readonly remove: boolean;
  readonly reason: string;
  readonly ageMs: number;
} {
  const { row, nowMs, liveness } = options;
  if (
    row.keep ||
    options.leasedTargets.has(row.id) ||
    options.leasedTargets.has(row.name)
  ) {
    return { remove: false, reason: "kept or leased", ageMs: 0 };
  }

  const createdMs = parseFlexibleTimestampMs(row.createdAtRaw);
  const ageMs = createdMs === null ? 0 : Math.max(0, nowMs - createdMs);

  const expiresMs = parseFlexibleTimestampMs(row.expiresAtRaw);
  if (expiresMs !== null && expiresMs <= nowMs) {
    return {
      remove: true,
      reason: `mc-harness.expires-at passed (${formatDurationCompact(nowMs - expiresMs)} ago)`,
      ageMs,
    };
  }

  const daemonPid = Number(row.daemonPidRaw);
  const hasDaemonPid = Number.isInteger(daemonPid) && daemonPid > 0;
  const daemonPidAlive = hasDaemonPid && liveness.processes.has(daemonPid);
  if (
    !daemonPidAlive &&
    !options.mcDaemonLive &&
    ageMs >= MC_ORPHAN_CONTAINER_MIN_AGE_MS
  ) {
    return {
      remove: true,
      reason: `orphaned mc-harness container (${hasDaemonPid ? `dead daemon pid ${String(daemonPid)}` : "no live daemon"}, age ${formatDurationCompact(ageMs)})`,
      ageMs,
    };
  }

  return { remove: false, reason: "active", ageMs };
}

function assertSafeVolumePruneArgv(argv: readonly string[]): void {
  if (argv.includes("--all") || argv.includes("-a")) {
    throw new Error(
      "Safety violation: docker volume prune must never pass --all or -a",
    );
  }
}

function countNonEmptyLines(stdout: string, exitCode: number): number {
  return exitCode === 0
    ? stdout.split(/\r?\n/u).filter((line) => line.trim().length > 0).length
    : 0;
}

function collectActiveDockerLeases(
  leases: readonly ClassifiedLease[] | undefined,
): Set<string> {
  const leasedContainers = new Set<string>();
  for (const item of leases ?? []) {
    if (item.status === "active" && item.lease.kind === "docker-container") {
      leasedContainers.add(item.lease.target);
    }
  }
  return leasedContainers;
}

async function sweepManagedMcContainers(options: {
  readonly managedRows: readonly ManagedMcContainerRow[];
  readonly nowMs: number;
  readonly liveness: LivenessSnapshot;
  readonly leasedContainers: ReadonlySet<string>;
  readonly apply: boolean;
  readonly runner: CommandRunner;
  readonly candidates: TendCandidate[];
  readonly actions: TendActionOutcome[];
}): Promise<void> {
  const mcDaemonLive = hasLiveMcHarnessDaemon(options.liveness.processes);
  for (const row of options.managedRows) {
    const verdict = evaluateManagedMcContainer({
      row,
      nowMs: options.nowMs,
      liveness: options.liveness,
      mcDaemonLive,
      leasedTargets: options.leasedContainers,
    });
    if (!verdict.remove) {
      continue;
    }
    const candidate: TendCandidate = {
      id: `docker-mc:${row.id}`,
      surface: "docker",
      kind: "mc-harness-container",
      target: row.name.length > 0 ? `${row.name} (${row.id})` : row.id,
      reason: verdict.reason,
      ageSeconds: Math.floor(verdict.ageMs / 1000),
    };
    options.candidates.push(candidate);
    if (!options.apply) {
      options.actions.push({ candidate, status: "planned" });
      continue;
    }
    const rmRes = await options.runner(["docker", "rm", "-f", "-v", row.id], {
      timeoutMs: 10_000,
    });
    options.actions.push({
      candidate,
      status: rmRes.exitCode === 0 ? "removed" : "failed",
      ...(rmRes.exitCode === 0
        ? {}
        : { detail: rmRes.stderr.trim() || "docker rm failed" }),
    });
  }
}

function recordDockerBulkCandidates(options: {
  readonly stoppedCount: number;
  readonly danglingVolumeCount: number;
  readonly apply: boolean;
  readonly candidates: TendCandidate[];
  readonly actions: TendActionOutcome[];
}): void {
  if (options.stoppedCount > 0) {
    const candidate: TendCandidate = {
      id: "docker:stopped-containers",
      surface: "docker",
      kind: "stopped-containers",
      target: `${String(options.stoppedCount)} exited/dead container(s)`,
      reason: "prune stopped containers older than 1h",
    };
    options.candidates.push(candidate);
    if (!options.apply) {
      options.actions.push({ candidate, status: "planned" });
    }
  }

  if (options.danglingVolumeCount > 0) {
    const candidate: TendCandidate = {
      id: "docker:anonymous-volumes",
      surface: "docker",
      kind: "anonymous-volumes",
      target: `${String(options.danglingVolumeCount)} dangling volume(s)`,
      reason: "prune unreferenced anonymous volumes (preserving named volumes)",
    };
    options.candidates.push(candidate);
    if (!options.apply) {
      options.actions.push({ candidate, status: "planned" });
    }
  }
}

async function executeDockerPruneSteps(options: {
  readonly stoppedCount: number;
  readonly danglingVolumeCount: number;
  readonly runner: CommandRunner;
  readonly candidates: readonly TendCandidate[];
  readonly actions: TendActionOutcome[];
  readonly warnings: string[];
}): Promise<void> {
  assertSafeVolumePruneArgv(DOCKER_VOLUME_PRUNE_ARGV);
  const pruneCommands: readonly {
    readonly argv: readonly string[];
    readonly candidateId?: string | undefined;
  }[] = [
    {
      argv: DOCKER_CONTAINER_PRUNE_ARGV,
      ...(options.stoppedCount > 0
        ? { candidateId: "docker:stopped-containers" }
        : {}),
    },
    {
      argv: DOCKER_VOLUME_PRUNE_ARGV,
      ...(options.danglingVolumeCount > 0
        ? { candidateId: "docker:anonymous-volumes" }
        : {}),
    },
    { argv: DOCKER_IMAGE_PRUNE_ARGV },
    { argv: DOCKER_BUILDER_PRUNE_ARGV },
  ];
  for (const step of pruneCommands) {
    const res = await options.runner(step.argv, { timeoutMs: 30_000 });
    const matchingCandidate =
      step.candidateId === undefined
        ? undefined
        : options.candidates.find((c) => c.id === step.candidateId);
    if (matchingCandidate !== undefined) {
      options.actions.push({
        candidate: matchingCandidate,
        status: res.exitCode === 0 ? "removed" : "failed",
        ...(res.exitCode === 0 ? {} : { detail: res.stderr.trim() }),
      });
    } else if (res.exitCode !== 0) {
      options.warnings.push(
        `${step.argv.join(" ")} failed: ${res.stderr.trim() || String(res.exitCode)}`,
      );
    }
  }
}

export type SweepDockerOptions = {
  readonly liveness: LivenessSnapshot;
  readonly leases?: readonly ClassifiedLease[] | undefined;
  readonly runner?: CommandRunner | undefined;
  readonly apply: boolean;
  readonly nowMs?: number | undefined;
};

export async function sweepDocker(
  options: SweepDockerOptions,
): Promise<SurfaceSweepResult> {
  const heldReason = options.liveness.holdSurfaces.get("docker");
  if (heldReason !== undefined) {
    return {
      surface: "docker",
      heldReason,
      inspectedCount: 0,
      candidates: [],
      actions: [],
      warnings: [],
    };
  }

  const runner = options.runner ?? defaultCommandRunner;
  const nowMs = options.nowMs ?? Date.now();

  const infoRes = await runner(
    ["docker", "info", "--format", "{{.ServerVersion}}"],
    { timeoutMs: 3000 },
  );
  if (infoRes.exitCode !== 0) {
    return {
      surface: "docker",
      skippedReason: "docker daemon not running",
      inspectedCount: 0,
      candidates: [],
      actions: [],
      warnings: [],
    };
  }

  const leasedContainers = collectActiveDockerLeases(options.leases);
  const [managedRes, stoppedRes, danglingVolRes] = await Promise.all([
    runner(
      [
        "docker",
        "ps",
        "--filter",
        "label=mc-harness.managed=true",
        "--format",
        MC_MANAGED_PS_FORMAT,
      ],
      { timeoutMs: 5000 },
    ),
    runner(
      [
        "docker",
        "ps",
        "-a",
        "--filter",
        "status=exited",
        "--filter",
        "status=dead",
        "--format",
        "{{.ID}}\t{{.CreatedAt}}",
      ],
      { timeoutMs: 5000 },
    ),
    runner(["docker", "volume", "ls", "-q", "--filter", "dangling=true"], {
      timeoutMs: 5000,
    }),
  ]);

  const managedRows =
    managedRes.exitCode === 0
      ? parseManagedMcContainers(managedRes.stdout)
      : [];
  const stoppedCount = countNonEmptyLines(
    stoppedRes.stdout,
    stoppedRes.exitCode,
  );
  const danglingVolumeCount = countNonEmptyLines(
    danglingVolRes.stdout,
    danglingVolRes.exitCode,
  );
  const candidates: TendCandidate[] = [];
  const actions: TendActionOutcome[] = [];
  const warnings: string[] = [];

  await sweepManagedMcContainers({
    managedRows,
    nowMs,
    liveness: options.liveness,
    leasedContainers,
    apply: options.apply,
    runner,
    candidates,
    actions,
  });
  recordDockerBulkCandidates({
    stoppedCount,
    danglingVolumeCount,
    apply: options.apply,
    candidates,
    actions,
  });

  if (options.apply) {
    await executeDockerPruneSteps({
      stoppedCount,
      danglingVolumeCount,
      runner,
      candidates,
      actions,
      warnings,
    });
  }

  return {
    surface: "docker",
    inspectedCount: managedRows.length + stoppedCount + danglingVolumeCount,
    candidates,
    actions,
    warnings,
  };
}
