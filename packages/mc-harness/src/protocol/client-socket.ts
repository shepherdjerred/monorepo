import { createConnection } from "node:net";
import { z } from "zod";

export const RequestSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1).max(100),
  action: z.string().min(1).max(32),
  arguments: z.record(z.string(), z.unknown()),
});

export const ResponseSchema = z.discriminatedUnion("ok", [
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

export const ConnectedClientStateShape = {
  position: z.tuple([z.number(), z.number(), z.number()]),
  yaw: z.number(),
  pitch: z.number(),
  health: z.number(),
  food: z.number(),
  world: z.string(),
  hotbar: z.number().int(),
  screen: z.string(),
  target: z.looseObject({ kind: z.enum(["block", "entity", "miss"]) }),
  fps: z.number(),
  heldInputs: z.array(z.string()),
  pid: z.number().int(),
};

const MAX_RESPONSE_BYTES = 1_048_576;

export class ClientRefusedError extends Error {}

/** Exchange one versioned newline-delimited request over a control socket. */
export function exchangeClientSocket(
  socketPath: string,
  message: z.infer<typeof RequestSchema>,
  timeoutMs = 15_000,
): Promise<unknown> {
  RequestSchema.parse(message);
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const settle = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error === undefined) resolve(value);
      else reject(error);
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
      settle(new Error("Client command timed out"));
    });
    socket.once("end", () => {
      settle(new Error("Client connection ended before its response"));
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_RESPONSE_BYTES) {
        settle(new Error("Client response too large"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        const reply = ResponseSchema.parse(
          JSON.parse(buffer.slice(0, newline)),
        );
        if (reply.id !== message.id)
          throw new Error("Client response ID mismatch");
        if (!reply.ok) throw new ClientRefusedError(reply.error);
        settle(undefined, reply.result);
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
