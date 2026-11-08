import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { installedToolkitPath } from "#lib/credential-cache.ts";

/**
 * Budget controls for 1Password service-account reads.
 *
 * The whole 1Password account shares one daily request budget across every
 * host and agent. Three things keep reads inside it:
 *
 * - a process that cannot use the Keychain cache (a `bun` source run, an
 *   import from another package) borrows the installed binary's cache through
 *   `toolkit run` instead of calling `op` itself;
 * - a per-reference lock lets one of many concurrent cold callers read while
 *   the rest wait for its cache entry;
 * - a JSONL log records every resolution (never a value) so remaining usage
 *   can be attributed to a host, runtime, command and credential.
 */

type Run = (
  argv: string[],
  extraEnvironment?: Readonly<Record<string, string>>,
) => Promise<{ exit: number; stdout: string; stderr: string }>;

/** Set on a delegated child so it never delegates back. */
export const DELEGATED_ENVIRONMENT = "TOOLKIT_CREDENTIAL_DELEGATED";

const RESOLVED_LINE = /^toolkit: [A-Z0-9_]+ via [a-z-]+$/;

/**
 * The installed toolkit to borrow a cache from, or null when this process
 * must read for itself: outside macOS, inside a delegated child, when this is
 * the installed binary, or when none is installed.
 */
export async function liveDelegate(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  if (Bun.env[DELEGATED_ENVIRONMENT] === "1") return null;
  const installed = installedToolkitPath();
  if (process.execPath === installed) return null;
  return (await Bun.file(installed).exists()) ? installed : null;
}

const ReferencesSchema = z.array(
  z.looseObject({ name: z.string(), ref: z.string() }),
);

/** Per runner: the installed binary's effective `op://` reference per name. */
const installedReferences = new WeakMap<
  Run,
  Map<string, Promise<ReadonlyMap<string, string> | null>>
>();

async function readInstalledReferences(
  installed: string,
  run: Run,
): Promise<ReadonlyMap<string, string> | null> {
  // `credentials references` lists locators only and never reads a value.
  const result = await run([installed, "credentials", "references", "--json"], {
    [DELEGATED_ENVIRONMENT]: "1",
  });
  if (result.exit !== 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  const entries = ReferencesSchema.safeParse(parsed);
  return entries.success
    ? new Map(entries.data.map((entry) => [entry.name, entry.ref]))
    : null;
}

function referencesOf(
  installed: string,
  run: Run,
): Promise<ReadonlyMap<string, string> | null> {
  let byBinary = installedReferences.get(run);
  if (byBinary === undefined) {
    byBinary = new Map();
    installedReferences.set(run, byBinary);
  }
  let references = byBinary.get(installed);
  if (references === undefined) {
    references = readInstalledReferences(installed, run);
    byBinary.set(installed, references);
  }
  return references;
}

/**
 * Resolve one credential through the installed binary's cache. It delegates
 * only when that binary resolves the name to the same `op://` reference this
 * process chose (an older install or a different config file may not), and
 * passes an explicit service-account token along. `toolkit run` hands the
 * value to `printenv` only; the captured stdout is returned and never logged.
 * Returns null when delegation does not apply, so the caller reads directly.
 */
export async function readDelegated(
  name: string,
  ref: string,
  installed: string,
  run: Run,
): Promise<string | null> {
  const references = await referencesOf(installed, run);
  if (references?.get(name) !== ref) return null;
  const token = Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
  const result = await run(
    [installed, "run", "--env", name, "--", "/usr/bin/printenv", name],
    {
      [DELEGATED_ENVIRONMENT]: "1",
      ...(token !== undefined && token.length > 0
        ? { OP_SERVICE_ACCOUNT_TOKEN: token }
        : {}),
    },
  );
  const lines = result.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines.filter((entry) => RESOLVED_LINE.test(entry))) {
    console.error(line);
  }
  const value = result.exit === 0 ? result.stdout.trim() : "";
  if (value.length > 0) return value;
  if (/unknown credential|unknown option|Usage: toolkit/.test(result.stderr)) {
    return null;
  }
  const detail = lines.find((line) => !RESOLVED_LINE.test(line));
  throw new Error(
    detail ??
      `toolkit: ${name} could not be resolved through ${installed} (exit ${String(result.exit)})`,
  );
}

/** Run `body` while holding the lock for one `op://` reference. */
export type ReferenceLock = <T>(
  ref: string,
  body: () => Promise<T>,
) => Promise<T>;

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

const OWNER_FILE = "owner";

async function lockOwner(directory: string): Promise<string | null> {
  try {
    return await readFile(path.join(directory, OWNER_FILE), "utf8");
  } catch {
    return null;
  }
}

/** Whether the process named by an owner record (`pid:token`) is running. */
function ownerAlive(owner: string): boolean {
  const pid = Number.parseInt(owner.split(":")[0] ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return errorCode(error) === "EPERM";
  }
}

async function abandoned(
  directory: string,
  owner: string | null,
  staleMs: number,
): Promise<boolean> {
  if (owner !== null) return !ownerAlive(owner);
  // Created but not yet claimed, or the holder died in between.
  try {
    const info = await stat(directory);
    return Date.now() - info.mtimeMs > staleMs;
  } catch {
    return false;
  }
}

/**
 * A lock held as a directory per reference (`mkdir` is atomic) with an owner
 * record of `pid:token`. A waiter takes over only from a dead owner, or from
 * an unclaimed directory older than `staleMs`, and a holder releases only its
 * own lock. A waiter that runs out of `maxWaitMs` proceeds without the lock:
 * the lock saves budget, it does not guard correctness.
 */
export function directoryLock(options: {
  readonly root: string;
  readonly staleMs?: number;
  readonly pollMs?: number;
  readonly maxWaitMs?: number;
}): ReferenceLock {
  const staleMs = options.staleMs ?? 30_000;
  const pollMs = options.pollMs ?? 200;
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  return async (ref, body) => {
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    const directory = path.join(
      options.root,
      createHash("sha256").update(ref).digest("hex"),
    );
    const mine = `${String(process.pid)}:${randomUUID()}`;
    const deadline = Date.now() + maxWaitMs;
    let held = false;
    while (!held && Date.now() < deadline) {
      try {
        await mkdir(directory);
        await writeFile(path.join(directory, OWNER_FILE), mine, {
          mode: 0o600,
        });
        held = true;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        const owner = await lockOwner(directory);
        const takeOver =
          (await abandoned(directory, owner, staleMs)) &&
          (await lockOwner(directory)) === owner;
        if (takeOver) {
          await rm(directory, { recursive: true, force: true });
        } else {
          await Bun.sleep(pollMs);
        }
      }
    }
    try {
      return await body();
    } finally {
      if (held && (await lockOwner(directory)) === mine) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  };
}

export function liveReferenceLock(): ReferenceLock {
  return directoryLock({
    root: path.join(
      os.homedir(),
      "Library",
      "Caches",
      "toolkit",
      "credential-locks",
    ),
  });
}

export type ReadEvent = {
  readonly name: string;
  /** cache, delegated, service-account, config, keychain; null on failure. */
  readonly backend: string | null;
  readonly outcome: "ok" | "rate-limited" | "error";
};

export type ReadLog = (event: ReadEvent) => Promise<void>;

const COMMAND_WORD = /^[a-z][a-z0-9-]*$/;

/** The first two command words, which never carry a value. */
function commandLabel(argv: readonly string[]): string {
  return argv
    .slice(2, 4)
    .map((word) => (COMMAND_WORD.test(word) ? word : "?"))
    .join(" ");
}

const LOG_FILE = /^credential-reads-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Daily file name, shared with `scripts/onepassword/with-service-account.sh`. */
export function readLogFile(directory: string, at: Date): string {
  return path.join(
    directory,
    `credential-reads-${at.toISOString().slice(0, 10)}.jsonl`,
  );
}

async function pruneReadLogs(
  directory: string,
  at: Date,
  retainDays: number,
): Promise<void> {
  const cutoff = new Date(at.getTime() - retainDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const entry of await readdir(directory)) {
    const day = LOG_FILE.exec(entry)?.[1];
    if (day !== undefined && day < cutoff) {
      await rm(path.join(directory, entry), { force: true });
    }
  }
}

/**
 * Append one JSON line per resolution to a daily file and drop files older
 * than `retainDays`; appends are atomic and nothing is renamed, so concurrent
 * processes cannot lose records. The log is diagnostics: a write failure is
 * reported once on stderr and never fails the command.
 */
export function fileReadLog(options: {
  readonly directory: string;
  readonly retainDays?: number;
  readonly now?: () => Date;
}): ReadLog {
  const retainDays = options.retainDays ?? 14;
  const now = options.now ?? (() => new Date());
  const context = {
    host: os.hostname(),
    runtime:
      process.execPath === installedToolkitPath() ? "installed" : "source",
    command: commandLabel(process.argv),
    ppid: process.ppid,
  };
  let pruned = false;
  let reported = false;
  return async (event) => {
    const at = now();
    const line = JSON.stringify({ ts: at.toISOString(), ...context, ...event });
    try {
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      await appendFile(readLogFile(options.directory, at), `${line}\n`, {
        mode: 0o600,
      });
      if (!pruned) {
        pruned = true;
        await pruneReadLogs(options.directory, at, retainDays);
      }
    } catch (error) {
      if (!reported) {
        reported = true;
        console.error(
          `toolkit: credential read log in ${options.directory} unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };
}

export function liveReadLog(): ReadLog {
  return fileReadLog({
    directory: path.join(os.homedir(), ".toolkit", "logs"),
  });
}

/**
 * The exhausted rows of `op service-account ratelimit`, as one sentence, or
 * null when no row is exhausted or the table is unrecognised.
 */
export function exhaustedBudget(table: string): string | null {
  // Columns: TYPE ACTION LIMIT USED REMAINING RESET (RESET has spaces).
  const rows = table.split("\n").flatMap((line) => {
    const [type, action, limit, used, remaining, ...reset] = line
      .trim()
      .split(/\s+/);
    const known = type === "token" || type === "account";
    return known && remaining === "0" && reset.length > 0
      ? [
          `${type} ${String(action)} ${String(used)}/${String(limit)} used, resets ${reset.join(" ")}`,
        ]
      : [];
  });
  return rows.length === 0
    ? null
    : `1Password budget exhausted (${rows.join("; ")}); see \`op service-account ratelimit\``;
}
