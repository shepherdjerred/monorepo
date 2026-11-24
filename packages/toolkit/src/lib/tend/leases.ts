import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  type PinchtabLeaseTeardownResult,
  reapPinchtabLeaseTarget,
} from "#lib/pinchtab-cli/client.ts";
import type { PinchtabClientOptions } from "#lib/pinchtab-cli/http.ts";
import { parseDurationMs, resolveTendPaths, type TendPaths } from "./paths.ts";
import { processStartsMatch, readSingleProcessStart } from "./process-probe.ts";
import {
  type ClassifiedLease,
  type CommandRunner,
  type Lease,
  type LeaseKind,
  LeaseSchema,
  type OsProcessEntry,
  type SurfaceSweepResult,
  type TendActionOutcome,
  type TendCandidate,
} from "./types.ts";

export type AcquireLeaseOptions = {
  readonly kind: LeaseKind;
  readonly target: string;
  readonly ttlMs?: number | undefined;
  readonly ttl?: string | undefined;
  readonly ownerPid?: number | undefined;
  readonly processStart?: string | undefined;
  readonly hcTerminal?: string | undefined;
  readonly worktree?: string | undefined;
  readonly id?: string | undefined;
  readonly nowMs?: number | undefined;
  readonly paths?: TendPaths | undefined;
  readonly runner?: CommandRunner | undefined;
  readonly platform?: NodeJS.Platform | undefined;
};

const DEFAULT_LEASE_TTL_MS = 4 * 60 * 60 * 1000;

function sanitizeLeaseId(raw: string): string {
  const cleaned = raw.trim().replaceAll(/[^\w.-]+/gu, "-");
  if (cleaned.length === 0) {
    throw new Error("Lease id must not be empty");
  }
  return cleaned;
}

export async function acquireLease(
  options: AcquireLeaseOptions,
): Promise<Lease> {
  const paths = options.paths ?? resolveTendPaths();
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs =
    options.ttlMs ??
    (options.ttl === undefined
      ? DEFAULT_LEASE_TTL_MS
      : parseDurationMs(options.ttl));
  const ownerPid = options.ownerPid ?? process.ppid;
  const resolvedStart =
    options.processStart ??
    (await readSingleProcessStart(ownerPid, {
      runner: options.runner,
      platform: options.platform,
    })) ??
    `unknown-${String(ownerPid)}`;

  const hcTerminal =
    options.hcTerminal ??
    Bun.env["HC_TERMINAL_ID"] ??
    Bun.env["WEZTERM_PANE"] ??
    undefined;

  const id = sanitizeLeaseId(options.id ?? `${options.kind}-${randomUUID()}`);
  const lease: Lease = LeaseSchema.parse({
    version: 1,
    id,
    kind: options.kind,
    target: options.target,
    ownerPid,
    processStart: resolvedStart,
    ...(hcTerminal !== undefined && hcTerminal.length > 0
      ? { hcTerminal }
      : {}),
    ...(options.worktree !== undefined && options.worktree.length > 0
      ? { worktree: options.worktree }
      : {}),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  });

  await mkdir(paths.leasesDir, { recursive: true, mode: 0o700 });
  const finalPath = path.join(paths.leasesDir, `${lease.id}.json`);
  const tempPath = `${finalPath}.${randomUUID()}.tmp`;
  await Bun.write(tempPath, `${JSON.stringify(lease, null, 2)}\n`);
  await rename(tempPath, finalPath);
  return lease;
}

export async function releaseLease(
  id: string,
  options: { readonly paths?: TendPaths | undefined } = {},
): Promise<boolean> {
  const paths = options.paths ?? resolveTendPaths();
  const safeId = sanitizeLeaseId(id);
  const targetFile = path.join(paths.leasesDir, `${safeId}.json`);
  const exists = await Bun.file(targetFile).exists();
  await rm(targetFile, { force: true });
  return exists;
}

function classifySingleLease(
  lease: Lease,
  nowMs: number,
  processes: ReadonlyMap<number, OsProcessEntry> | undefined,
): ClassifiedLease {
  const expiresMs = Date.parse(lease.expiresAt);
  if (Number.isNaN(expiresMs) || nowMs >= expiresMs) {
    return {
      lease,
      status: "expired",
      reason: `expired at ${lease.expiresAt}`,
    };
  }
  if (processes !== undefined) {
    const proc = processes.get(lease.ownerPid);
    if (proc === undefined) {
      return {
        lease,
        status: "dead-owner",
        reason: `owner pid ${String(lease.ownerPid)} is not running`,
      };
    }
    if (
      !lease.processStart.startsWith("unknown-") &&
      !processStartsMatch(proc.processStart, lease.processStart)
    ) {
      return {
        lease,
        status: "dead-owner",
        reason: `owner pid ${String(lease.ownerPid)} reused (started ${proc.processStart}, expected ${lease.processStart})`,
      };
    }
  }
  return {
    lease,
    status: "active",
    reason: `active until ${lease.expiresAt}`,
  };
}

export async function listLeases(
  options: {
    readonly paths?: TendPaths | undefined;
    readonly nowMs?: number | undefined;
    readonly processes?: ReadonlyMap<number, OsProcessEntry> | undefined;
  } = {},
): Promise<ClassifiedLease[]> {
  const paths = options.paths ?? resolveTendPaths();
  const nowMs = options.nowMs ?? Date.now();
  let entries: string[];
  try {
    entries = await readdir(paths.leasesDir);
  } catch {
    return [];
  }
  const results: ClassifiedLease[] = [];
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(paths.leasesDir, name);
    try {
      const raw: unknown = JSON.parse(await Bun.file(filePath).text());
      const parsed = LeaseSchema.safeParse(raw);
      if (!parsed.success) {
        continue;
      }
      results.push(classifySingleLease(parsed.data, nowMs, options.processes));
    } catch {
      // Ignore unreadable or half-written lease file.
    }
  }
  return results;
}

function leaseTeardownOrder(item: ClassifiedLease): number {
  if (item.lease.kind !== "pinchtab") {
    return 2;
  }
  const target = item.lease.target.trim();
  return target.startsWith("ses_") || target.startsWith("session:") ? 1 : 0;
}

async function applyInactiveLeaseSweep(options: {
  readonly item: ClassifiedLease;
  readonly candidate: TendCandidate;
  readonly apply: boolean;
  readonly paths?: TendPaths | undefined;
  readonly reapPinchtab: (
    target: string,
  ) => Promise<PinchtabLeaseTeardownResult>;
  readonly warnings: string[];
}): Promise<TendActionOutcome> {
  if (!options.apply) {
    return { candidate: options.candidate, status: "planned" };
  }
  if (options.item.lease.kind === "pinchtab") {
    const teardown = await options.reapPinchtab(options.item.lease.target);
    if (!teardown.ok) {
      return {
        candidate: options.candidate,
        status: "failed",
        ...(teardown.detail === undefined ? {} : { detail: teardown.detail }),
      };
    }
    if (teardown.skipped === true && teardown.detail !== undefined) {
      options.warnings.push(
        `PinchTab lease ${options.item.lease.id} (${options.item.lease.target}): ${teardown.detail}`,
      );
    }
  }
  const removed = await releaseLease(options.item.lease.id, {
    paths: options.paths,
  });
  return {
    candidate: options.candidate,
    status: removed ? "removed" : "skipped",
  };
}

export async function sweepLeases(options: {
  readonly paths?: TendPaths | undefined;
  readonly nowMs?: number | undefined;
  readonly processes: ReadonlyMap<number, OsProcessEntry>;
  readonly apply: boolean;
  readonly pinchtab?: PinchtabClientOptions | undefined;
  readonly reapPinchtab?:
    ((target: string) => Promise<PinchtabLeaseTeardownResult>) | undefined;
}): Promise<{
  readonly sweep: SurfaceSweepResult;
  readonly classified: readonly ClassifiedLease[];
}> {
  const nowMs = options.nowMs ?? Date.now();
  const classified = await listLeases({
    paths: options.paths,
    nowMs,
    processes: options.processes,
  });
  const candidates: TendCandidate[] = [];
  const actions: TendActionOutcome[] = [];
  const warnings: string[] = [];
  const reapPinchtab =
    options.reapPinchtab ??
    ((target: string) => reapPinchtabLeaseTarget(target, options.pinchtab));

  const inactive = classified
    .filter((item) => item.status !== "active")
    .sort((a, b) => leaseTeardownOrder(a) - leaseTeardownOrder(b));

  for (const item of inactive) {
    const createdMs = Date.parse(item.lease.createdAt);
    const ageSeconds = Number.isNaN(createdMs)
      ? undefined
      : Math.max(0, Math.floor((nowMs - createdMs) / 1000));
    const candidate: TendCandidate = {
      id: `lease:${item.lease.id}`,
      surface: "leases",
      kind: item.lease.kind,
      target: item.lease.id,
      reason: `${item.status}: ${item.reason} (target ${item.lease.target})`,
      ...(ageSeconds === undefined ? {} : { ageSeconds }),
    };
    candidates.push(candidate);
    actions.push(
      await applyInactiveLeaseSweep({
        item,
        candidate,
        apply: options.apply,
        paths: options.paths,
        reapPinchtab,
        warnings,
      }),
    );
  }

  return {
    classified,
    sweep: {
      surface: "leases",
      inspectedCount: classified.length,
      candidates,
      actions,
      warnings,
    },
  };
}

export async function wrapWithLease(options: {
  readonly kind: LeaseKind;
  readonly target: string;
  readonly command: readonly string[];
  readonly ttl?: string | undefined;
  readonly worktree?: string | undefined;
  readonly paths?: TendPaths | undefined;
  readonly runner?: CommandRunner | undefined;
}): Promise<number> {
  if (options.command.length === 0) {
    throw new Error("wrapWithLease requires a command after --");
  }
  const lease = await acquireLease({
    kind: options.kind,
    target: options.target,
    ttl: options.ttl,
    ownerPid: process.pid,
    worktree: options.worktree,
    paths: options.paths,
    runner: options.runner,
  });
  try {
    if (options.runner !== undefined) {
      const res = await options.runner(options.command);
      return res.exitCode;
    }
    const child = Bun.spawn([...options.command], {
      stdio: ["inherit", "inherit", "inherit"],
      env: Bun.env,
    });
    return await child.exited;
  } finally {
    await releaseLease(lease.id, { paths: options.paths });
  }
}
