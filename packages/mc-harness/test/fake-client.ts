import { createServer, type Server } from "node:net";
import path from "node:path";
import { z } from "zod";
import type { ClientLauncher, LaunchSpec } from "#daemon/clients.ts";

const RequestSchema = z.strictObject({
  version: z.literal(1),
  id: z.string(),
  action: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

/**
 * Stands in for the Fabric preview mod: a unix socket server speaking its
 * newline-delimited JSON protocol, with just enough state for the daemon.
 */
export type FakeClient = {
  launcher: ClientLauncher;
  launches: LaunchSpec[];
  /** Every request the fake received, in order. */
  requests: { action: string; arguments: Record<string, unknown> }[];
  /** Status polls answered as "not connected" before joining. */
  joinAfterPolls: number;
  /** Exit immediately with this code instead of serving. */
  crashWith: number | undefined;
};

export function fakeClient(): FakeClient {
  const fake: FakeClient = {
    launches: [],
    requests: [],
    joinAfterPolls: 1,
    crashWith: undefined,
    launcher: (spec) => {
      fake.launches.push(spec);
      let exitCode: number | null = null;
      const { promise: exited, resolve } = Promise.withResolvers<number>();
      const exit = (code: number) => {
        if (exitCode === null) {
          exitCode = code;
          resolve(code);
        }
      };
      let server: Server | undefined;
      if (fake.crashWith === undefined) {
        server = serve(fake, spec, () => {
          server?.close();
          exit(0);
        });
      } else {
        const code = fake.crashWith;
        setTimeout(() => {
          exit(code);
        }, 10);
      }
      return {
        pid: 4242,
        exited,
        exitCode: () => exitCode,
        kill: (signal) => {
          server?.close();
          exit(signal === "SIGKILL" ? 137 : 143);
        },
      };
    },
  };
  return fake;
}

function serve(fake: FakeClient, spec: LaunchSpec, quit: () => void): Server {
  let polls = 0;
  let yaw = 0;
  let pitch = 0;
  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const request = RequestSchema.parse(JSON.parse(buffer.slice(0, newline)));
      fake.requests.push({
        action: request.action,
        arguments: request.arguments,
      });
      const answer = (body: Record<string, unknown>) => {
        socket.end(
          `${JSON.stringify({ version: 1, id: request.id, ...body })}\n`,
        );
      };
      void (async () => {
        switch (request.action) {
          case "status": {
            polls += 1;
            answer({
              ok: true,
              result:
                polls <= fake.joinAfterPolls
                  ? { connected: false, screen: "Joining world" }
                  : connectedState(yaw, pitch),
            });
            return;
          }
          case "look": {
            yaw = Number(request.arguments["yaw"]);
            pitch = Number(request.arguments["pitch"]);
            answer({ ok: true, result: "Camera updated" });
            return;
          }
          case "attack": {
            answer({ ok: false, error: "Aim at an entity" });
            return;
          }
          case "capture": {
            const file = path.join(
              spec.bootstrap.artifacts,
              `${String(request.arguments["name"])}.png`,
            );
            await Bun.write(file, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
            answer({ ok: true, result: { path: file } });
            return;
          }
          case "shutdown": {
            answer({ ok: true, result: "Client stopping" });
            setTimeout(quit, 10);
            return;
          }
          default: {
            answer({ ok: true, result: `${request.action} done` });
          }
        }
      })();
    });
  });
  server.listen(spec.bootstrap.socket);
  return server;
}

function connectedState(yaw: number, pitch: number) {
  return {
    connected: true,
    position: [0.5, -60, 0.5],
    yaw,
    pitch,
    health: 20,
    food: 20,
    world: "minecraft:overworld",
    hotbar: 0,
    screen: "",
    containerId: 0,
    stateId: 0,
    cursor: {
      slot: -1,
      type: "minecraft:air",
      count: 0,
      name: "Air",
      components: "{}",
    },
    inventory: [
      {
        slot: 0,
        type: "minecraft:stone",
        count: 64,
        name: "Stone",
        components: "{}",
      },
    ],
    slots: [],
    target: {
      kind: "block",
      position: [0, -61, 2],
      type: "minecraft:grass_block",
    },
    fps: 60,
    heldInputs: [],
    pid: 777,
  };
}
