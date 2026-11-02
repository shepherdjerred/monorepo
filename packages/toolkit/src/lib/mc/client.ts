import path from "node:path";
import type { z } from "zod";
import {
  ErrorResponseSchema,
  StatusResponseSchema,
} from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import {
  DEFAULT_DAEMON_TTL_SECONDS,
  SOCKET_PATH,
} from "@shepherdjerred/mc-harness/protocol/paths.ts";
import { pathExists } from "@shepherdjerred/unix-socket-daemon";
import { repoRoot } from "#lib/deployed/git.ts";

export const START_HINT =
  "The mc daemon is not running. Start it with: toolkit mc daemon start";

export type DaemonMethod = "GET" | "POST" | "DELETE";

/**
 * Starts the daemon (default TTL) on the first request that finds none, so
 * agents never need a separate `daemon start`. The note goes to stderr to keep
 * stdout and `--json` clean. TOOLKIT_MC_NO_AUTOSTART=1 restores the hint.
 */
async function autoStartDaemon(): Promise<void> {
  if (Bun.env["TOOLKIT_MC_NO_AUTOSTART"] === "1") {
    throw new Error(START_HINT);
  }
  // Dynamic: spawn.ts imports this module for its readiness probe.
  const { startMcDaemon } = await import("#lib/mc/spawn.ts");
  const status = await startMcDaemon(DEFAULT_DAEMON_TTL_SECONDS);
  console.error(
    `Started the mc daemon (pid ${String(status.pid)}); stop it with 'toolkit mc daemon stop'.`,
  );
}

/**
 * The shared socket may belong to a daemon started from another worktree.
 * That daemon can own a live sandbox, so a mismatch is refused and the other
 * process is left running. Both paths are absolute.
 */
export function daemonCheckoutMismatch(
  daemonRoot: string,
  checkout: string,
): string | null {
  const daemon = path.resolve(daemonRoot);
  const here = path.resolve(checkout);
  return daemon === here
    ? null
    : `The mc daemon at ${SOCKET_PATH} is serving ${daemon}, but this checkout is ${here}. Stop that daemon from its own checkout; this command will not stop a daemon that may own a live sandbox.`;
}

async function assertDaemonCheckout(): Promise<void> {
  const checkout = await repoRoot();
  if (checkout === null) {
    throw new Error("toolkit mc must run inside the monorepo checkout");
  }
  let response: Response;
  try {
    response = await fetch("http://daemon/status", { unix: SOCKET_PATH });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not read the mc daemon status (${message}). The socket exists but the daemon may have died — run 'toolkit mc daemon stop', then start it again.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `mc daemon status failed (HTTP ${String(response.status)})`,
    );
  }
  const status = StatusResponseSchema.parse(await response.json());
  const mismatch = daemonCheckoutMismatch(status.repoRoot, checkout);
  if (mismatch !== null) throw new Error(mismatch);
}

/** One request to the mc-harness daemon over its unix socket. */
export function daemonRequest<Schema extends z.ZodType>(
  schema: Schema,
  method: DaemonMethod,
  resourcePath: string,
  body?: unknown,
): Promise<z.infer<Schema>> {
  return daemonSend(schema, method, resourcePath, { body });
}

/**
 * `daemonRequest` with headers: live write flags (reason, confirmations) for
 * `/targets/live/...` writes.
 */
export async function daemonSend<Schema extends z.ZodType>(
  schema: Schema,
  method: DaemonMethod,
  resourcePath: string,
  init: { body?: unknown; headers?: Record<string, string> },
): Promise<z.infer<Schema>> {
  const { body, headers = {} } = init;
  if (await pathExists(SOCKET_PATH)) {
    await assertDaemonCheckout();
  } else {
    await autoStartDaemon();
  }
  let response: Response;
  try {
    response = await fetch(`http://daemon${resourcePath}`, {
      unix: SOCKET_PATH,
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach the mc daemon (${message}). The socket exists but the daemon may have died — run 'toolkit mc daemon stop', then start it again.`,
      { cause: error },
    );
  }
  const json: unknown = await response.json();
  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(json);
    throw new Error(
      parsed.success
        ? `mc daemon: ${parsed.data.error}`
        : `mc daemon error (HTTP ${String(response.status)})`,
    );
  }
  return schema.parse(json);
}
