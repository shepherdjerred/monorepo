import type { z } from "zod";
import { ErrorResponseSchema } from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import {
  DEFAULT_DAEMON_TTL_SECONDS,
  SOCKET_PATH,
} from "@shepherdjerred/mc-harness/protocol/paths.ts";
import { pathExists } from "@shepherdjerred/unix-socket-daemon";

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

/** One request to the mc-harness daemon over its unix socket. */
export function daemonRequest<Schema extends z.ZodType>(
  schema: Schema,
  method: DaemonMethod,
  path: string,
  body?: unknown,
): Promise<z.infer<Schema>> {
  return daemonSend(schema, method, path, { body });
}

/**
 * `daemonRequest` with headers: live write flags (reason, confirmations) for
 * `/targets/live/...` writes.
 */
export async function daemonSend<Schema extends z.ZodType>(
  schema: Schema,
  method: DaemonMethod,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> },
): Promise<z.infer<Schema>> {
  const { body, headers = {} } = init;
  if (!(await pathExists(SOCKET_PATH))) {
    await autoStartDaemon();
  }
  let response: Response;
  try {
    response = await fetch(`http://daemon${path}`, {
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
