/**
 * Ownership records for harness-created databases on the shared local server.
 *
 * Writes `monorepo-test-owner/v1 ` comments and parses both
 * `monorepo-test-owner/v1 ` and legacy `scout-test-owner/v1 ` comments.
 */
import { hostname } from "node:os";
import { z } from "zod";
import { type CommandRunner, runCommandSync } from "./binaries.ts";

function runPowerShellProbe(
  run: CommandRunner,
  shell: string,
  script: string,
): string | undefined {
  let result: ReturnType<CommandRunner>;
  try {
    result = run([shell, "-NoProfile", "-NonInteractive", "-Command", script]);
  } catch {
    return undefined;
  }
  if (result.exitCode !== 0) {
    return undefined;
  }
  const trimmed = result.stdout.trim();
  return trimmed === "" ? undefined : trimmed;
}

function windowsProcessStart(
  pid: number,
  run: CommandRunner,
): string | undefined {
  const cimScript = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${String(pid)}'; if ($null -ne $p -and $null -ne $p.CreationDate) { $p.CreationDate.ToUniversalTime().ToString('O') } else { exit 1 }`;
  const dotnetScript = `try { (Get-Process -Id ${String(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('O') } catch { exit 1 }`;
  for (const shell of ["powershell.exe", "pwsh.exe"]) {
    const fromCim = runPowerShellProbe(run, shell, cimScript);
    if (fromCim !== undefined) return fromCim;
    const fromDotnet = runPowerShellProbe(run, shell, dotnetScript);
    if (fromDotnet !== undefined) return fromDotnet;
  }
  return undefined;
}

export function processStartForPid(
  pid: number,
  options?: {
    readonly platform?: NodeJS.Platform;
    readonly run?: CommandRunner;
  },
): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  const platform = options?.platform ?? process.platform;
  const run = options?.run ?? ((argv, env) => runCommandSync(argv, { env }));

  if (platform === "win32") {
    return windowsProcessStart(pid, run);
  }

  // UTC and the C locale so every session on the host formats it identically.
  const result = run(["ps", "-o", "lstart=", "-p", pid.toString()], {
    TZ: "UTC",
    LC_ALL: "C",
  });
  if (result.exitCode !== 0) {
    return undefined;
  }
  const started = result.stdout.trim();
  return started === "" ? undefined : started;
}

let cachedOwnProcessStart: string | undefined;

export function currentProcessStart(options?: {
  readonly platform?: NodeJS.Platform;
  readonly run?: CommandRunner;
}): string {
  const isDefault =
    options?.platform === undefined && options?.run === undefined;
  if (isDefault && cachedOwnProcessStart !== undefined) {
    return cachedOwnProcessStart;
  }
  const started = processStartForPid(process.pid, options);
  if (started === undefined) {
    throw new Error(
      `Cannot read this test process's start time for pid ${process.pid.toString()}; test databases need it to record their owner`,
    );
  }
  if (isDefault) {
    cachedOwnProcessStart = started;
  }
  return started;
}

export const OWNER_MARKER = "monorepo-test-owner/v1 ";
export const LEGACY_SCOUT_OWNER_MARKER = "scout-test-owner/v1 ";

/** Owned databases younger than this are kept by default during sweeps. */
export const SWEEP_GRACE_MS = 5 * 60 * 1000;

/** Stale template databases with a superseded hash are kept for 24h so other worktrees retain their cache. */
export const STALE_TEMPLATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const DatabaseOwnerSchema = z.strictObject({
  host: z.string().min(1),
  pid: z.number().int().positive(),
  /** Process start timestamp (`ps -o lstart=` in UTC/C on Unix, ISO UTC CreationDate on Windows). */
  processStart: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  /** Set on a template database only once its build has completed. */
  templateHash: z.string().min(1).optional(),
});
export type DatabaseOwner = z.infer<typeof DatabaseOwnerSchema>;

export type OwnerRecord =
  | { kind: "owned"; owner: DatabaseOwner }
  | { kind: "none" }
  | { kind: "malformed"; comment: string };

/** What the sweep needs to know about processes on this host. */
export type ProcessProbe = {
  host: string;
  /** False only when the PID provably does not exist (ESRCH). */
  isAlive: (pid: number) => boolean;
  /** The PID's start time in the recorded format, or undefined if unknown. */
  startTime: (pid: number) => string | undefined;
};

export function formatOwnerComment(owner: DatabaseOwner): string {
  return `${OWNER_MARKER}${JSON.stringify(DatabaseOwnerSchema.parse(owner))}`;
}

function extractOwnerPayload(comment: string | null): string | undefined {
  if (comment === null) return undefined;
  if (comment.startsWith(OWNER_MARKER)) {
    return comment.slice(OWNER_MARKER.length);
  }
  return comment.startsWith(LEGACY_SCOUT_OWNER_MARKER)
    ? comment.slice(LEGACY_SCOUT_OWNER_MARKER.length)
    : undefined;
}

export function parseOwnerComment(comment: string | null): OwnerRecord {
  const payload = extractOwnerPayload(comment);
  if (payload === undefined || comment === null) {
    return { kind: "none" };
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    const result = DatabaseOwnerSchema.safeParse(parsed);
    return result.success
      ? { kind: "owned", owner: result.data }
      : { kind: "malformed", comment };
  } catch {
    return { kind: "malformed", comment };
  }
}

/** SQL string literal for a COMMENT ON DATABASE value. */
export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function ownerCommentSql(
  databaseName: string,
  owner: DatabaseOwner,
): string {
  return `COMMENT ON DATABASE "${databaseName}" IS ${sqlLiteral(formatOwnerComment(owner))}`;
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the PID exists under another user: alive, not ours to judge.
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

export const hostProcessProbe: ProcessProbe = {
  host: hostname(),
  isAlive: processIsAlive,
  startTime: (pid: number) => processStartForPid(pid),
};

/** The owner record for a database this process is about to create. */
export function currentDatabaseOwner(now = Date.now()): DatabaseOwner {
  return {
    host: hostProcessProbe.host,
    pid: process.pid,
    processStart: currentProcessStart(),
    createdAt: now,
  };
}

export type OwnerProcessState =
  "foreign-host" | "alive" | "start-unknown" | "gone";

/**
 * Whether the recorded owner process has provably exited: same host, and the
 * PID is dead or now belongs to a process started at a different time.
 */
export function ownerProcessState(
  owner: DatabaseOwner,
  probe: ProcessProbe,
): OwnerProcessState {
  if (owner.host !== probe.host) {
    return "foreign-host";
  }
  if (!probe.isAlive(owner.pid)) {
    return "gone";
  }
  const started = probe.startTime(owner.pid);
  if (started === undefined) {
    return "start-unknown";
  }
  return started === owner.processStart ? "alive" : "gone";
}

export type SweepDecision =
  | { action: "drop" }
  | {
      action: "keep";
      reason:
        | "unowned"
        | "malformed-owner"
        | "foreign-host"
        | "owner-alive"
        | "owner-start-unknown"
        | "within-grace"
        | "active-connections";
    };

/**
 * Drops a `*_test_*` / `*_mig_*` database only when its owner record names
 * this host, the owner process is gone, it is past `graceMs`, and nothing is
 * connected. Age alone never drops anything.
 */
export function decideSweep(input: {
  record: OwnerRecord;
  activeConnections: number;
  now: number;
  probe: ProcessProbe;
  graceMs?: number;
}): SweepDecision {
  const {
    record,
    activeConnections,
    now,
    probe,
    graceMs = SWEEP_GRACE_MS,
  } = input;
  if (record.kind === "none") {
    return { action: "keep", reason: "unowned" };
  }
  if (record.kind === "malformed") {
    return { action: "keep", reason: "malformed-owner" };
  }
  switch (ownerProcessState(record.owner, probe)) {
    case "foreign-host":
      return { action: "keep", reason: "foreign-host" };
    case "alive":
      return { action: "keep", reason: "owner-alive" };
    case "start-unknown":
      return { action: "keep", reason: "owner-start-unknown" };
    case "gone":
      break;
  }
  if (now - record.owner.createdAt < graceMs) {
    return { action: "keep", reason: "within-grace" };
  }
  return activeConnections > 0
    ? { action: "keep", reason: "active-connections" }
    : { action: "drop" };
}

export type TemplateRebuildDecision =
  | { action: "create" }
  | { action: "drop-partial" }
  | { action: "refuse"; reason: string };

/**
 * Called under the template advisory lock once the template's hash did not
 * read back. Only an incomplete build whose builder is provably gone from this
 * host, with nothing connected, is dropped; a completed or foreign template
 * never is.
 */
export function decideTemplateRebuild(input: {
  exists: boolean;
  isTemplate?: boolean | undefined;
  record: OwnerRecord;
  wantedHash: string;
  activeConnections: number;
  probe: ProcessProbe;
}): TemplateRebuildDecision {
  const { exists, isTemplate, record, wantedHash, activeConnections, probe } =
    input;
  if (!exists) {
    return { action: "create" };
  }
  if (record.kind !== "owned") {
    return {
      action: "refuse",
      reason: "it has no harness owner record, so it may belong to another run",
    };
  }
  if (isTemplate !== false && record.owner.templateHash === wantedHash) {
    return {
      action: "refuse",
      reason:
        "it is a completed template whose hash could not be read back; check the server instead of rebuilding",
    };
  }
  const state = ownerProcessState(record.owner, probe);
  if (state !== "gone") {
    return {
      action: "refuse",
      reason: `its builder (pid ${record.owner.pid.toString()} on ${record.owner.host}) is not provably gone (${state})`,
    };
  }
  if (activeConnections > 0) {
    return {
      action: "refuse",
      reason: `it still has ${activeConnections.toString()} connection(s)`,
    };
  }
  return { action: "drop-partial" };
}

export type StaleTemplateDecision =
  | { action: "drop" }
  | {
      action: "keep";
      reason:
        | "current-template"
        | "unowned"
        | "foreign-host"
        | "within-retention"
        | "active-connections"
        | "builder-active";
    };

/**
 * Prunes a superseded `<prefix>_template_*` database only when it has a
 * different name/hash, belongs to this host, has 0 active connections, and is
 * older than 24 hours.
 */
export function decideStaleTemplatePrune(input: {
  databaseName: string;
  currentTemplateName: string;
  record: OwnerRecord;
  activeConnections: number;
  now: number;
  probe: ProcessProbe;
  maxAgeMs?: number;
}): StaleTemplateDecision {
  const {
    databaseName,
    currentTemplateName,
    record,
    activeConnections,
    now,
    probe,
    maxAgeMs = STALE_TEMPLATE_MAX_AGE_MS,
  } = input;
  if (databaseName === currentTemplateName) {
    return { action: "keep", reason: "current-template" };
  }
  if (record.kind !== "owned") {
    return { action: "keep", reason: "unowned" };
  }
  if (record.owner.host !== probe.host) {
    return { action: "keep", reason: "foreign-host" };
  }
  if (activeConnections > 0) {
    return { action: "keep", reason: "active-connections" };
  }
  if (now - record.owner.createdAt <= maxAgeMs) {
    return { action: "keep", reason: "within-retention" };
  }
  const incompleteAndLive =
    record.owner.templateHash === undefined &&
    ownerProcessState(record.owner, probe) !== "gone";
  return incompleteAndLive
    ? { action: "keep", reason: "builder-active" }
    : { action: "drop" };
}
