import type { z } from "zod";
import { SOCKET_PATH } from "#protocol/paths.ts";
import { liveWriteHeaders } from "#protocol/live.ts";
import { ErrorResponseSchema } from "#protocol/ipc.ts";

/** The child only holds daemon access, never a bridge or vault credential. */
export class CaptureTransport {
  constructor(
    readonly target: string,
    readonly reason: string,
    private readonly socket = SOCKET_PATH,
    private readonly captureClient?: string,
  ) {}

  async request<T extends z.ZodType>(
    schema: T,
    method: "GET" | "POST" | "DELETE",
    route: string,
    body?: unknown,
  ): Promise<z.infer<T>> {
    const response = await fetch(`http://daemon${route}`, {
      unix: this.socket,
      method,
      headers: {
        "content-type": "application/json",
        ...liveWriteHeaders({ reason: this.reason }),
        ...(this.captureClient === undefined
          ? {}
          : { "x-mc-capture-client": this.captureClient }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(180_000),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = ErrorResponseSchema.safeParse(value);
      throw new Error(
        error.success
          ? error.data.error
          : `Capture daemon HTTP ${response.status.toString()}`,
      );
    }
    return schema.parse(value);
  }

  world<T extends z.ZodType>(
    schema: T,
    action: string,
    body?: unknown,
  ): Promise<z.infer<T>> {
    return this.request(
      schema,
      body === undefined ? "GET" : "POST",
      `/targets/${encodeURIComponent(this.target)}/${action}`,
      body,
    );
  }
}
