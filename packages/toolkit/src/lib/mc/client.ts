import path from "node:path";
import type { z } from "zod";
import {
  ErrorResponseSchema,
  type StatusResponse,
} from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import {
  DEFAULT_DAEMON_TTL_SECONDS,
  SOCKET_PATH,
} from "@shepherdjerred/mc-harness/protocol/paths.ts";
import { repoRoot } from "#lib/deployed/git.ts";
import {
  assertProtocol,
  cleanDeadMcDaemonFiles,
  ensureMcDaemon,
  probeMcDaemonStatus,
} from "#lib/mc/spawn.ts";

export const START_HINT =
  "The mc daemon is not running. Start it with: toolkit mc daemon start";

export type DaemonMethod = "GET" | "POST" | "DELETE";

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

async function assertStatusMatchesCheckout(
  status: StatusResponse,
): Promise<void> {
  assertProtocol(status);
  const checkout = await repoRoot();
  if (checkout === null) {
    throw new Error("toolkit mc must run inside the monorepo checkout");
  }
  const mismatch = daemonCheckoutMismatch(status.repoRoot, checkout);
  if (mismatch !== null) {
    throw new Error(mismatch);
  }
}

/**
 * Ensures a live, checkout-matched daemon is listening on `SOCKET_PATH`,
 * recovering stale crashed state/socket files and serializing concurrent
 * auto-starts through `ensureMcDaemon`.
 */
async function ensureReadyCheckoutDaemon(): Promise<void> {
  const existing = await probeMcDaemonStatus();
  if (existing !== null) {
    await assertStatusMatchesCheckout(existing);
    return;
  }

  if (Bun.env["TOOLKIT_MC_NO_AUTOSTART"] === "1") {
    await cleanDeadMcDaemonFiles();
    throw new Error(START_HINT);
  }

  const { status, started } = await ensureMcDaemon(DEFAULT_DAEMON_TTL_SECONDS);
  if (started) {
    console.error(
      `Started the mc daemon (pid ${String(status.pid)}); stop it with 'toolkit mc daemon stop'.`,
    );
  }
  await assertStatusMatchesCheckout(status);
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
  await ensureReadyCheckoutDaemon();

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
      `Could not reach the mc daemon (${message}). The daemon may have exited during the request — retry the command.`,
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
