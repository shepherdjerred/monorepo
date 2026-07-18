/**
 * Shared subprocess helper for the deploy/release automation scripts.
 *
 * All automation here must FAIL FAST (repo policy): a non-zero exit from any
 * required tool aborts the whole script with a clear message. Nothing in
 * this tree swallows errors, hides stderr, or falls back silently.
 */

export type RunOptions = {
  cwd?: string;
  /** Extra env vars layered on top of the current process env. */
  env?: Record<string, string>;
  /**
   * When true, capture stdout and return it instead of inheriting the parent's
   * stdio. stderr is always inherited so tool diagnostics stream to the operator.
   */
  capture?: boolean;
  /**
   * When true, do NOT echo captured stdout back to the parent's stdout. Only
   * meaningful with `capture: true`. Use this for commands whose stdout is a
   * secret (e.g. a minted token) — echoing captured stdout would leak the
   * secret into the build log even though the caller "captured" it.
   */
  quiet?: boolean;
};

export type RunResult = {
  stdout: string;
  exitCode: number;
};

/**
 * Spawn a command and wait for it. Throws on any non-zero exit — callers that
 * need to inspect a specific exit code (e.g. `tofu plan -detailed-exitcode`,
 * where 2 means "changes detected", not failure) must use `runAllowExit`.
 */
export async function run(
  cmd: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const result = await runAllowExit(cmd, opts);
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (exit ${result.exitCode.toString()}): ${cmd.join(" ")}`,
    );
  }
  return result;
}

/**
 * Spawn a command and wait for it, returning the exit code without throwing.
 * Use only where a non-zero exit is a meaningful signal the caller decodes.
 */
export async function runAllowExit(
  cmd: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const [bin, ...args] = cmd;
  if (bin === undefined) {
    throw new Error("run: empty command");
  }
  const capture = opts.capture === true;
  const proc = Bun.spawn([bin, ...args], {
    // `exactOptionalPropertyTypes` forbids passing `cwd: undefined`; spread the
    // key in only when a cwd was actually provided.
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    env: opts.env === undefined ? Bun.env : { ...Bun.env, ...opts.env },
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const stdout = capture ? await new Response(proc.stdout).text() : "";
  const exitCode = await proc.exited;
  if (capture && opts.quiet !== true) {
    // Echo captured stdout so the operator still sees it in the terminal.
    // Suppressed when `quiet` is set — used for secret-bearing output that must
    // never reach the log.
    process.stdout.write(stdout);
  }
  return { stdout, exitCode };
}

/** Require an env var to be present and non-empty; throw a clear error otherwise. */
export function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Provide it via the environment (operators wrap these scripts with \`op run\`).`,
    );
  }
  return value;
}

/** Read an optional env var, returning null when absent/empty. */
export function optionalEnv(name: string): string | null {
  const value = Bun.env[name];
  return value === undefined || value === "" ? null : value;
}

/** The temp base dir (TMPDIR or /tmp), without a trailing slash. */
export function tmpBase(): string {
  const dir = Bun.env["TMPDIR"] ?? "/tmp";
  return dir.endsWith("/") ? dir.slice(0, -1) : dir;
}
