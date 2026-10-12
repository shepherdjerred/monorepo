import type { z } from "zod";
import { ErrorResponseSchema } from "#protocol/ipc.ts";
import { SOCKET_PATH } from "#protocol/paths.ts";

/**
 * The playtest child's link to the daemon: every target operation goes
 * through the daemon's unix socket, so the child never holds a bridge token.
 */
export class DaemonClient {
  constructor(
    readonly targetId: string,
    private readonly socketPath = SOCKET_PATH,
  ) {}

  /** A call on `/targets/<id>/<action>`. */
  target<Schema extends z.ZodType>(
    schema: Schema,
    method: "GET" | "POST" | "DELETE",
    action: string,
    body?: unknown,
  ): Promise<z.infer<Schema>> {
    return this.request(
      schema,
      method,
      `/targets/${encodeURIComponent(this.targetId)}/${action}`,
      body,
    );
  }

  async request<Schema extends z.ZodType>(
    schema: Schema,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<z.infer<Schema>> {
    const response = await fetch(`http://daemon${path}`, {
      unix: this.socketPath,
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    });
    const json: unknown = await response.json();
    if (!response.ok) {
      const parsed = ErrorResponseSchema.safeParse(json);
      throw new Error(
        parsed.success
          ? parsed.data.error
          : `mc daemon error (HTTP ${response.status.toString()})`,
      );
    }
    return schema.parse(json);
  }
}
