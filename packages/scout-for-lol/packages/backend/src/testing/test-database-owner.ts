/**
 * Ownership records for harness-created databases on the shared dev server.
 *
 * Several checkouts and sessions share one machine-wide Postgres (port 5471
 * by default), so a database's name and age say nothing about who may still
 * be using it. Every database the harness creates carries a
 * `COMMENT ON DATABASE` owner record — host, owning PID and that process's
 * start time — and cleanup acts only on databases whose recorded owner is
 * provably gone from this host. A database with no record (legacy, another
 * tool, a crash between CREATE and COMMENT) is never dropped.
 *
 * The decision functions here are pure over an injected process probe so they
 * can be tested without Postgres; nothing in this module connects to it.
 */
import { hostname } from "node:os";
import { z } from "zod";

const OWNER_MARKER = "scout-test-owner/v1 ";

/** Owned databases younger than this are never swept, whatever their owner. */
export const SWEEP_GRACE_MS = 5 * 60 * 1000;

const DatabaseOwnerSchema = z.strictObject({
  host: z.string().min(1),
  pid: z.number().int().positive(),
  /** `ps -o lstart=` of `pid` in UTC/C locale: tells a reused PID apart. */
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

export function parseOwnerComment(comment: string | null): OwnerRecord {
  if (comment?.startsWith(OWNER_MARKER) !== true) {
    return { kind: "none" };
  }
  try {
    const parsed: unknown = JSON.parse(comment.slice(OWNER_MARKER.length));
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

function processStartTime(pid: number): string | undefined {
  // UTC and the C locale so every session on the host formats it identically.
  const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", pid.toString()], {
    env: { ...Bun.env, TZ: "UTC", LC_ALL: "C" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    return undefined;
  }
  const started = result.stdout.toString().trim();
  return started === "" ? undefined : started;
}

function processIsAlive(pid: number): boolean {
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
  startTime: processStartTime,
};

let ownProcessStart: string | undefined;

/** The owner record for a database this process is about to create. */
export function currentDatabaseOwner(now = Date.now()): DatabaseOwner {
  if (ownProcessStart === undefined) {
    const started = processStartTime(process.pid);
    if (started === undefined) {
      throw new Error(
        `Cannot read this test process's start time with \`ps -o lstart= -p ${process.pid.toString()}\`; test databases need it to record their owner`,
      );
    }
    ownProcessStart = started;
  }
  return {
    host: hostProcessProbe.host,
    pid: process.pid,
    processStart: ownProcessStart,
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
    // It exited between the two probes, or ps failed; neither proves it gone.
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
 * The sweep drops a `scout_test_*` database only when its owner record names
 * this host, the owner process is gone, it is past the grace period, and
 * nothing is connected. Age alone never drops anything.
 */
export function decideSweep(input: {
  record: OwnerRecord;
  activeConnections: number;
  now: number;
  probe: ProcessProbe;
}): SweepDecision {
  const { record, activeConnections, now, probe } = input;
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
  if (now - record.owner.createdAt < SWEEP_GRACE_MS) {
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
 * Called under the template lock once the template's hash did not read back.
 * Only an incomplete build whose builder is provably gone from this host, with
 * nothing connected, is dropped; a completed or foreign template never is.
 */
export function decideTemplateRebuild(input: {
  exists: boolean;
  record: OwnerRecord;
  wantedHash: string;
  activeConnections: number;
  probe: ProcessProbe;
}): TemplateRebuildDecision {
  const { exists, record, wantedHash, activeConnections, probe } = input;
  if (!exists) {
    return { action: "create" };
  }
  if (record.kind !== "owned") {
    return {
      action: "refuse",
      reason: "it has no harness owner record, so it may belong to another run",
    };
  }
  if (record.owner.templateHash === wantedHash) {
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
