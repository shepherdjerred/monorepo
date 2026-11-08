import { createHash } from "node:crypto";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

/**
 * Resolve one credential through the installed binary's cache. `toolkit run`
 * hands the value to `printenv` only; the captured stdout is returned and
 * never logged. Returns null when that binary does not know the credential
 * (an older install), so the caller reads it directly.
 */
export async function readDelegated(
  name: string,
  installed: string,
  run: Run,
): Promise<string | null> {
  const result = await run(
    [installed, "run", "--env", name, "--", "/usr/bin/printenv", name],
    { [DELEGATED_ENVIRONMENT]: "1" },
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

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function lockAgeMs(
  directory: string,
  now: number,
): Promise<number | null> {
  try {
    const info = await stat(directory);
    return now - info.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * A lock held as a directory per reference (`mkdir` is atomic). A holder that
 * died leaves a directory older than `staleMs`, which the next caller removes.
 * A waiter that runs out of `maxWaitMs` proceeds without the lock rather than
 * failing the command.
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
    const deadline = Date.now() + maxWaitMs;
    let held = false;
    while (!held && Date.now() < deadline) {
      try {
        await mkdir(directory);
        held = true;
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        const age = await lockAgeMs(directory, Date.now());
        if (age !== null && age > staleMs) {
          await rm(directory, { recursive: true, force: true });
        } else {
          await Bun.sleep(pollMs);
        }
      }
    }
    try {
      return await body();
    } finally {
      if (held) await rm(directory, { recursive: true, force: true });
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

/**
 * Append one JSON line per resolution. The log is diagnostics: a write
 * failure is reported once on stderr and never fails the command.
 */
export function fileReadLog(options: {
  readonly file: string;
  readonly maxBytes?: number;
  readonly now?: () => Date;
}): ReadLog {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const now = options.now ?? (() => new Date());
  const context = {
    host: os.hostname(),
    runtime:
      process.execPath === installedToolkitPath() ? "installed" : "source",
    command: commandLabel(process.argv),
    ppid: process.ppid,
  };
  let reported = false;
  return async (event) => {
    const line = JSON.stringify({
      ts: now().toISOString(),
      ...context,
      ...event,
    });
    try {
      await mkdir(path.dirname(options.file), { recursive: true, mode: 0o700 });
      const size = await stat(options.file).then(
        (info) => info.size,
        () => 0,
      );
      if (size > maxBytes) await rename(options.file, `${options.file}.1`);
      await appendFile(options.file, `${line}\n`, { mode: 0o600 });
    } catch (error) {
      if (!reported) {
        reported = true;
        console.error(
          `toolkit: credential read log ${options.file} unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };
}

export function liveReadLog(): ReadLog {
  return fileReadLog({
    file: path.join(os.homedir(), ".toolkit", "logs", "credential-reads.jsonl"),
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
