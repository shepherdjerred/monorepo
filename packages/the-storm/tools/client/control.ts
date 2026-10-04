import { createServer, type Socket } from "node:net";
import { chmod } from "node:fs/promises";
import { z } from "zod";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { RequestSchema, waitFor } from "./protocol.ts";

export const ViewpointsSchema = z.record(
  z.string(),
  z.strictObject({
    position: z.tuple([z.number(), z.number(), z.number()]),
    yaw: z.number(),
    pitch: z.number(),
  }),
);
export type Viewpoints = z.infer<typeof ViewpointsSchema>;

async function fixture(rcon: RconClient, name: string): Promise<string> {
  if (name === "chest") {
    await rcon.command("forceload add 1596 2096 1616 2106");
    await waitFor(
      "fixture chunks",
      () =>
        rcon.command("execute if loaded 1596 72 2096 if loaded 1616 72 2106"),
      (reply) => reply === "Test passed",
    );
    for (const cmd of [
      "fill 1596 72 2096 1616 72 2106 minecraft:stone_bricks",
      "setblock 1600 73 2101 minecraft:barrel[facing=south]",
      "item replace block 1600 73 2101 container.0 with minecraft:bread 3",
      "give StormPreview minecraft:wooden_sword",
    ])
      await rcon.command(cmd);
    const floor = await rcon.command(
      "execute if block 1600 72 2103 minecraft:stone_bricks",
    );
    if (floor !== "Test passed")
      throw new Error(`Fixture floor failed: ${floor}`);
    return "Chest fixture prepared";
  }
  if (name === "enemy") {
    await rcon.command("difficulty normal");
    await rcon.command("kill @e[tag=storm_preview_fixture]");
    await rcon.command(
      'summon minecraft:zombie 1610.5 73 2101.5 {NoAI:1b,Silent:1b,Tags:["storm_preview_fixture"]}',
    );
    return "Enemy fixture prepared";
  }
  if (name === "enemy-health") {
    return await rcon.command(
      "data get entity @e[tag=storm_preview_fixture,limit=1] Health",
    );
  }
  throw new Error("Unknown fixture");
}

export async function startControl(options: {
  socket: string;
  rcon: RconClient;
  views: Viewpoints;
  stop: () => void;
}) {
  const peers = new Set<Socket>();
  const server = createServer((socket) => {
    peers.add(socket);
    socket.once("close", () => {
      peers.delete(socket);
    });
    let buffer = "";
    socket.setEncoding("utf8");
    socket.setTimeout(15_000, () => {
      socket.destroy();
    });
    socket.on("error", () => {
      socket.destroy();
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 65_536) {
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = "";
      socket.pause();
      void respond(socket, line, options);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socket, () => {
      resolve();
    });
  });
  await chmod(options.socket, 0o600);
  return async () => {
    for (const peer of peers) peer.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  };
}

async function respond(
  socket: Socket,
  line: string,
  options: {
    rcon: RconClient;
    views: Viewpoints;
    stop: () => void;
  },
): Promise<void> {
  try {
    const reply = await handle(line, options);
    socket.end(`${JSON.stringify(reply)}\n`);
  } catch {
    socket.destroy();
  }
}

async function handle(
  line: string,
  options: {
    rcon: RconClient;
    views: Viewpoints;
    stop: () => void;
  },
) {
  let id = "invalid";
  try {
    const command = RequestSchema.parse(JSON.parse(line));
    id = command.id;
    const result = await act(command, options);
    return { version: 1, id, ok: true, result };
  } catch (error) {
    return {
      version: 1,
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function act(
  command: z.infer<typeof RequestSchema>,
  options: {
    rcon: RconClient;
    views: Viewpoints;
    stop: () => void;
  },
): Promise<unknown> {
  if (command.action === "stop") {
    z.strictObject({}).parse(command.arguments);
    setTimeout(options.stop, 100);
    return "Stopping preview";
  }
  const { name } = z
    .strictObject({ name: z.string() })
    .parse(command.arguments);
  if (command.action === "fixture") return await fixture(options.rcon, name);
  if (command.action !== "viewpoint")
    throw new Error("Unknown preview control action");
  const view = options.views[name];
  if (view === undefined) throw new Error(`Unknown viewpoint: ${name}`);
  const [x, y, zz] = view.position;
  await options.rcon.command(
    `tp StormPreview ${x.toString()} ${y.toString()} ${zz.toString()} ${view.yaw.toString()} ${view.pitch.toString()}`,
  );
  return view;
}
