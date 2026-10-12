import { randomUUID } from "node:crypto";
import { exchangeClientSocket } from "#protocol/client-socket.ts";

/**
 * The preview client's control socket: versioned newline-delimited JSON, one
 * request per connection (the-storm/client/README.md). Input requests keep
 * their connection open until the held buttons are released, and closing the
 * connection early cancels them.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** The client answered and refused the action (bad state or arguments). */
export function clientRequest(
  socketPath: string,
  action: string,
  args: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const message = {
    version: 1 as const,
    id: randomUUID(),
    action,
    arguments: args,
  };
  return exchangeClientSocket(socketPath, message, timeoutMs);
}
