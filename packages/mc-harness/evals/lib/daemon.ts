import path from "node:path";
import type { z } from "zod";

/**
 * Talks to the mc daemon of one isolated HOME over its unix socket, the same
 * HTTP-over-socket the toolkit client uses. Graders use it instead of the CLI
 * so they never depend on argument parsing.
 */
export class DaemonClient {
  readonly socketPath: string;

  constructor(home: string) {
    this.socketPath = path.join(home, ".toolkit", "mc", "daemon.sock");
  }

  async request<T extends z.ZodType>(
    schema: T,
    method: "GET" | "POST" | "DELETE",
    route: string,
    body?: unknown,
  ): Promise<z.infer<T>> {
    const response = await fetch(`http://daemon${route}`, {
      method,
      unix: this.socketPath,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `daemon ${method} ${route} → ${String(response.status)}: ${text.slice(0, 500)}`,
      );
    }
    return schema.parse(JSON.parse(text));
  }

  async alive(): Promise<boolean> {
    try {
      const response = await fetch("http://daemon/status", {
        unix: this.socketPath,
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
