import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { z } from "zod";

/**
 * The preview client's control socket: versioned newline-delimited JSON, one
 * request per connection (the-storm/client/README.md). Input requests keep
 * their connection open until the held buttons are released, and closing the
 * connection early cancels them.
 */
const ResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    version: z.literal(1),
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.strictObject({
    version: z.literal(1),
    id: z.string(),
    ok: z.literal(false),
    error: z.string(),
  }),
]);

const MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 15_000;

/** The client answered and refused the action (bad state or arguments). */
export class ClientRefusedError extends Error {}

export function clientRequest(
  socketPath: string,
  action: string,
  args: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const message = { version: 1, id: randomUUID(), action, arguments: args };
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const settle = (error: Error | undefined, value?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error === undefined) {
        resolve(value);
      } else {
        reject(error);
      }
    };
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });
    socket.once("error", (error) => {
      settle(error);
    });
    socket.once("timeout", () => {
      settle(new Error(`client ${action} timed out`));
    });
    socket.once("end", () => {
      settle(
        new Error(`client closed the connection before answering ${action}`),
      );
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_RESPONSE_BYTES) {
        settle(new Error("client response too large"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      let reply: z.infer<typeof ResponseSchema>;
      try {
        reply = ResponseSchema.parse(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (reply.id !== message.id) {
        settle(new Error("client response id mismatch"));
      } else if (reply.ok) {
        settle(undefined, reply.result);
      } else {
        settle(new ClientRefusedError(reply.error));
      }
    });
  });
}
