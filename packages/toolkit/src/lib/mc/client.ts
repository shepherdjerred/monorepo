import { stat } from "node:fs/promises";
import type { z } from "zod";
import { ErrorResponseSchema } from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import { SOCKET_PATH } from "@shepherdjerred/mc-harness/protocol/paths.ts";

export const START_HINT =
  "The mc daemon is not running. Start it with: toolkit mc daemon start";

// Bun.file(path).exists() returns false for a unix socket, so use stat.
export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export type DaemonMethod = "GET" | "POST" | "DELETE";

/** One request to the mc-harness daemon over its unix socket. */
export async function daemonRequest<Schema extends z.ZodType>(
  schema: Schema,
  method: DaemonMethod,
  path: string,
  body?: unknown,
): Promise<z.infer<Schema>> {
  if (!(await pathExists(SOCKET_PATH))) {
    throw new Error(START_HINT);
  }
  let response: Response;
  try {
    response = await fetch(`http://daemon${path}`, {
      unix: SOCKET_PATH,
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
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
