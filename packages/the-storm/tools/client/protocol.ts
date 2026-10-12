import { appendFile, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  exchangeClientSocket,
  ConnectedClientStateShape,
} from "@shepherdjerred/mc-harness/protocol/client-socket.ts";
import type { RequestSchema } from "@shepherdjerred/mc-harness/protocol/client-socket.ts";

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
    ...ConnectedClientStateShape,
    connected: z.literal(true),
    containerId: z.number().int(),
    stateId: z.number().int(),
    cursor: ItemSchema,
    inventory: z.array(ItemSchema),
    slots: z.array(ItemSchema),
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
  return exchangeClientSocket(socketPath, message);
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
