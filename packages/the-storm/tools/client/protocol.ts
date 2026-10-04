import { createConnection } from "node:net";
import { appendFile, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
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

export const SessionSchema = z.strictObject({
  socket: z.string().min(1),
  artifacts: z.string().min(1),
  server: z.string().regex(/^127\.0\.0\.1:\d+$/u),
  control: z.string().min(1),
});
export type Session = z.infer<typeof SessionSchema>;

const ItemSchema = z.object({
  slot: z.number().int(),
  type: z.string(),
  count: z.number().int(),
  name: z.string(),
  components: z.string(),
});

export const StatusSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(false), screen: z.string() }),
  z.object({
    connected: z.literal(true),
    position: z.tuple([z.number(), z.number(), z.number()]),
    yaw: z.number(),
    pitch: z.number(),
    health: z.number(),
    food: z.number(),
    world: z.string(),
    hotbar: z.number().int(),
    screen: z.string(),
    containerId: z.number().int(),
    stateId: z.number().int(),
    cursor: ItemSchema,
    inventory: z.array(ItemSchema),
    slots: z.array(ItemSchema),
    target: z.looseObject({ kind: z.enum(["block", "entity", "miss"]) }),
    fps: z.number(),
    heldInputs: z.array(z.string()),
    pid: z.number().int(),
  }),
]);

export async function readSession(file: string): Promise<Session> {
  return SessionSchema.parse(await Bun.file(file).json());
}

export async function socketReady(file: string): Promise<boolean> {
  try {
    const info = await lstat(file);
    if (!info.isSocket()) throw new Error("Preview IPC path is not a socket");
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** One request per connection, keeping bounded input requests open until the lease expires. */
export function exchange(
  socketPath: string,
  message: z.infer<typeof RequestSchema>,
): Promise<unknown> {
  RequestSchema.parse(message);
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.setTimeout(15_000);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy(new Error("Preview command timed out"));
    });
    socket.once("end", () => {
      reject(new Error("Preview connection ended before its response"));
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 1_048_576) {
        socket.destroy(new Error("Preview response too large"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        const reply = ResponseSchema.parse(
          JSON.parse(buffer.slice(0, newline)),
        );
        if (reply.id !== message.id)
          throw new Error("Preview response ID mismatch");
        if (!reply.ok) throw new Error(reply.error);
        resolve(reply.result);
        socket.destroy();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        socket.destroy();
      }
    });
  });
}

export async function request(
  session: Session,
  action: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const command = {
    version: 1 as const,
    id: randomUUID(),
    action,
    arguments: args,
  };
  const started = performance.now();
  const control = ["viewpoint", "fixture", "stop"].includes(action);
  try {
    const result = await exchange(
      control ? session.control : session.socket,
      command,
    );
    await appendFile(
      path.join(session.artifacts, "commands.jsonl"),
      `${JSON.stringify({
        ...command,
        ok: true,
        durationMs: performance.now() - started,
        result,
      })}\n`,
    );
    return result;
  } catch (error) {
    await appendFile(
      path.join(session.artifacts, "commands.jsonl"),
      `${JSON.stringify({
        ...command,
        ok: false,
        durationMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    throw error;
  }
}

export async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
