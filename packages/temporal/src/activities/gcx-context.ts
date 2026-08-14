import { redactSecrets } from "#shared/redact.ts";

// gcx authenticates from a config file, not from environment variables. Its own
// two native variables for server and credential are banned repo-wide by
// scripts/environment-variable-rules.ts, which canonicalized them to
// GRAFANA_URL and GRAFANA_API_KEY, so the worker provisions a context once per
// pod lifetime instead.
//
// The worker sets GCX_CONFIG to pin where that config lands, keeping the
// credential's location independent of the base image's HOME.
const GCX_CONTEXT_NAME = "homelab";
const GCX_LOGIN_TIMEOUT_MS = 15_000;

export class GcxContextError extends Error {
  override readonly name = "GcxContextError";
}

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.trim() === "") {
    throw new GcxContextError(
      `${name} is required to provision the gcx "${GCX_CONTEXT_NAME}" context`,
    );
  }
  return value;
}

export type GcxSpawn = (args: string[]) => {
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: () => void;
};

const defaultSpawn: GcxSpawn = (args) =>
  Bun.spawn(args, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });

async function loginToGcx(spawn: GcxSpawn): Promise<void> {
  const server = requireEnv("GRAFANA_URL");
  const apiKey = requireEnv("GRAFANA_API_KEY");

  // `gcx login` is idempotent: re-running against an existing context replaces
  // the stored credential in place.
  const child = spawn([
    "gcx",
    "login",
    GCX_CONTEXT_NAME,
    "--server",
    server,
    "--token",
    apiKey,
    "--yes",
  ]);

  const timeout = setTimeout(() => {
    child.kill();
  }, GCX_LOGIN_TIMEOUT_MS);

  try {
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      // gcx echoes the --token argument back in some error paths, so the
      // credential is redacted before it can reach a Temporal failure message.
      const detail = redactSecrets(stderr.trim().slice(0, 1000), [apiKey]);
      throw new GcxContextError(
        `gcx login exited ${exitCode.toString()}: ${detail}`,
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
 */
export async function ensureGcxContext(
  spawn: GcxSpawn = defaultSpawn,
): Promise<void> {
  pending ??= (async () => {
    try {
      await loginToGcx(spawn);
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
