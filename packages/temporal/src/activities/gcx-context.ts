import { redactSecrets } from "#shared/redact.ts";

// gcx stores its credential in a config file, so the worker provisions a
// context once per pod lifetime. The worker sets GCX_CONFIG to pin where that
// config lands, keeping the credential's location independent of the base
// image's HOME.
//
// The credential reaches gcx through its own GRAFANA_TOKEN runtime override
// rather than `--token`: argv is readable by any process that can see
// /proc/<pid>/cmdline, so a `--token` value is exposed to anything sharing the
// pod's PID namespace. gcx documents this env form as its CI/CD path and its
// own login error names it as the alternative to the flag. `--server` is not a
// credential and stays an argument. scripts/environment-variable-rules.ts
// exempts this file for that vendor spelling; GRAFANA_URL/GRAFANA_API_KEY
// remain the canonical names this repo reads from.
const GCX_CONTEXT_NAME = "homelab";
const GCX_TOKEN_ENV = "GRAFANA_TOKEN";
const GCX_LOGIN_TIMEOUT_MS = 15_000;

export class GcxContextError extends Error {
  override readonly name = "GcxContextError";
}

function requireEnv(name: string): string {
  // Trimmed once and reused: the trimmed form is both what makes the value
  // non-blank and what gcx receives, so a trailing newline in the 1Password
  // field cannot reach the --server URL or the credential.
  const value = Bun.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new GcxContextError(
      `${name} is required to provision the gcx "${GCX_CONTEXT_NAME}" context`,
    );
  }
  return value;
}

export type GcxSpawn = (
  args: string[],
  env: Record<string, string>,
) => {
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: () => void;
};

const defaultSpawn: GcxSpawn = (args, env) =>
  Bun.spawn(args, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: { ...Bun.env, ...env },
  });

type SettleResult =
  | { readonly ok: true; readonly stderr: string; readonly exitCode: number }
  | { readonly ok: false; readonly error: unknown };

/**
 * Wait for the child, reporting a subprocess error as a value rather than a
 * rejection. The deadline below abandons this promise when it wins, and Bun
 * terminates the worker on an unhandled rejection, so this must not reject.
 */
async function settleChild(child: ReturnType<GcxSpawn>): Promise<SettleResult> {
  try {
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { ok: true, stderr, exitCode };
  } catch (error) {
    return { ok: false, error };
  }
}

async function loginToGcx(spawn: GcxSpawn, timeoutMs: number): Promise<void> {
  const server = requireEnv("GRAFANA_URL");
  const apiKey = requireEnv("GRAFANA_API_KEY");

  // `gcx login` is idempotent: re-running against an existing context replaces
  // the stored credential in place.
  const child = spawn(
    ["gcx", "login", GCX_CONTEXT_NAME, "--server", server, "--yes"],
    { [GCX_TOKEN_ENV]: apiKey },
  );

  const settled = settleChild(child);

  // Killing the child is only best-effort cleanup: a process that ignores the
  // signal, or a stderr stream that never closes, would leave `settled`
  // pending forever. The rejection below is what actually bounds the wait, so
  // the timeout is a deadline on this function rather than merely on when the
  // signal is sent.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      child.kill();
      reject(
        new GcxContextError(
          `gcx login did not complete within ${timeoutMs.toString()}ms`,
        ),
      );
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([settled, deadline]);
    if (!result.ok) {
      throw result.error;
    }
    if (result.exitCode !== 0) {
      // gcx can echo the credential back in some error paths (notably under
      // --insecure-log-http-payload), so it is redacted before it can reach a
      // Temporal failure message.
      const detail = redactSecrets(result.stderr.trim().slice(0, 1000), [
        apiKey,
      ]);
      throw new GcxContextError(
        `gcx login exited ${result.exitCode.toString()}: ${detail}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

let pending: Promise<void> | undefined;

/**
 * Provision the gcx `homelab` context from GRAFANA_URL/GRAFANA_API_KEY.
 *
 * Memoized for the pod's lifetime: the audit collector and the preflight both
 * call it, and neither should depend on the other having run first. A failure
 * is not cached, so a transient Grafana outage does not poison the process.
 *
 * `timeoutMs` is a test seam so the deadline can be exercised without a
 * multi-second test; production callers use GCX_LOGIN_TIMEOUT_MS.
 */
export async function ensureGcxContext(
  spawn: GcxSpawn = defaultSpawn,
  timeoutMs: number = GCX_LOGIN_TIMEOUT_MS,
): Promise<void> {
  pending ??= (async () => {
    try {
      await loginToGcx(spawn, timeoutMs);
    } catch (error) {
      pending = undefined;
      throw error;
    }
  })();
  return pending;
}

/** Test seam: forget the memoized login so each case starts clean. */
export function resetGcxContextForTesting(): void {
  pending = undefined;
}

export { GCX_CONTEXT_NAME };
