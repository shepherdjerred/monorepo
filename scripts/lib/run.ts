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
   * stdout. stderr is always streamed live to the operator regardless (and a
   * bounded tail is captured into `RunResult.stderr` either way).
   */
  capture?: boolean;
  /**
   * When true (with capture), do NOT echo the captured stdout back to the
   * terminal: the output is a credential (e.g. a minted GitHub token) and must
   * never appear in CI logs.
   */
  secret?: boolean;
};

export type RunResult = {
  stdout: string;
  /**
   * A bounded tail of the command's stderr, always captured (even when stdio is
   * inherited) so a caller — or the transient-failure classifier in
   * `lib/transient.ts` — can inspect the tool's own diagnostics. Live stderr is
   * still streamed to the operator as it arrives; this is a copy, not a divert.
   */
  stderr: string;
  exitCode: number;
};

/** Bytes of stderr retained for diagnostics / transient classification. */
const STDERR_TAIL_LIMIT = 16_384;

/**
 * Spawn a command and wait for it. Throws on any non-zero exit — callers that
 * need to inspect a specific exit code (e.g. `tofu plan -detailed-exitcode`,
 * where 2 means "changes detected", not failure) must use `runAllowExit`.
 *
 * The thrown error embeds a tail of the command's stderr. This is load-bearing
 * for retry classification: external tools (release-please, tofu, argocd) print
 * their 5xx/network diagnostics to stderr and then exit non-zero, so without
 * the tail the error would read only "Command failed (exit 1): <cmd>" and the
 * transient classifier (`isTransientError`) could never match — every transient
 * blip would hard-fail the build instead of retrying (build 5864: a GitHub 503
 * during release-please exited 1 rather than EXIT_TRANSIENT).
 */
export async function run(
  cmd: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const result = await runAllowExit(cmd, opts);
  if (result.exitCode !== 0) {
    const tail = result.stderr.trim();
    throw new Error(
      `Command failed (exit ${result.exitCode.toString()}): ${cmd.join(" ")}` +
        (tail === "" ? "" : `\n--- stderr (tail) ---\n${tail}`),
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
    // Always pipe stderr so we can retain a tail for diagnostics / transient
    // classification. `teeStderr` forwards every chunk to the parent's stderr
    // as it arrives, so the operator's live streaming is preserved — the pipe
    // is drained concurrently, so the child never blocks on a full buffer.
    stderr: "pipe",
  });
  const stderrTail = teeStderr(proc.stderr);
  const stdout = capture ? await new Response(proc.stdout).text() : "";
  const exitCode = await proc.exited;
  const stderr = await stderrTail;
  if (capture && opts.secret !== true) {
    // Echo captured stdout so the operator still sees it in the terminal.
    // Suppressed when `secret` is set — used for secret-bearing output that
    // must never reach the log.
    process.stdout.write(stdout);
  }
  return { stdout, stderr, exitCode };
}

/**
 * Drain a piped stderr stream, forwarding every chunk to the parent's stderr
 * live while retaining the last `STDERR_TAIL_LIMIT` bytes for the caller. The
 * concurrent drain is what keeps the child from deadlocking on a full pipe.
 */
async function teeStderr(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    process.stderr.write(value);
    tail += decoder.decode(value, { stream: true });
    if (tail.length > STDERR_TAIL_LIMIT) {
      tail = tail.slice(-STDERR_TAIL_LIMIT);
    }
  }
  tail += decoder.decode();
  return tail;
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
