import { z } from "zod";
import { CaptureTransport } from "#src/capture/transport.ts";
import type { CaptureFeatureSchema } from "#protocol/ipc.ts";
import {
  SandboxSummarySchema,
  SandboxDownResponseSchema,
} from "#protocol/ipc.ts";
import {
  ClientStatusResponseSchema,
  ClientActionResponseSchema,
} from "#protocol/client.ts";
import {
  CommandResponseSchema,
  WeRunResponseSchema,
} from "#protocol/bridge.ts";
import type { SuiteScenario } from "./define.ts";
import { worldFolder } from "./fixture.ts";

/** Minecraft centres integer x/z command arguments on their block. */
function coordinate(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : value.toString();
}

async function enterWorld(
  transport: CaptureTransport,
  command: string,
  world: string,
) {
  await transport.request(
    ClientActionResponseSchema,
    "POST",
    "/clients/XiguaJerred/command",
    { text: command },
  );
  const deadline = performance.now() + 30_000;
  for (;;) {
    const { state } = await transport.request(
      ClientStatusResponseSchema,
      "GET",
      "/clients/XiguaJerred",
    );
    if (state.connected && state.world === world) return;
    if (performance.now() > deadline)
      throw new Error(
        "Native camera did not enter the scenario's world through its entry command",
      );
    await Bun.sleep(100);
  }
}

/** Own only a newly created target. No global down/stop operations. */
export async function localSession(input: {
  mapDirectory: string;
  sourceDirectory: string;
  spawn: [number, number, number];
  helpers: string[];
  features?: z.infer<typeof CaptureFeatureSchema>[];
  rollout?: { url: string; environment: "prod" | "beta" };
}) {
  const control = new CaptureTransport(
    "suite",
    "Disposable documentation suite",
  );
  const server = await control.request(
    SandboxSummarySchema,
    "POST",
    "/sandboxes",
    {
      profile: "storm-dev",
      provider: "docker",
      world: "real-map",
      mapDirectory: input.mapDirectory,
      sourceDirectory: input.sourceDirectory,
      mapSpawn: input.spawn,
      ttlSeconds: 4 * 60 * 60,
      keep: false,
      ...(input.features === undefined || input.features.length === 0
        ? {}
        : { captureFeatures: input.features }),
      ...(input.rollout === undefined ? {} : { rollout: input.rollout }),
    },
  );
  const transport = new CaptureTransport(
    server.id,
    "Prepare isolated documentation state",
    undefined,
    "XiguaJerred",
  );
  const consoleCommand = async (text: string) => {
    const result = await transport.world(CommandResponseSchema, "command", {
      command: text,
    });
    if (!result.success)
      throw new Error(`Demo setup rejected: ${result.output.join("\n")}`);
  };
  try {
    for (const name of ["XiguaJerred", ...input.helpers]) {
      await control.request(ClientStatusResponseSchema, "POST", "/clients", {
        target: server.id,
        name,
        op: true,
        gameMode: "CREATIVE",
      });
      // Finish the initial join before a teleport can replace its loading chunks.
      const deadline = performance.now() + 30_000;
      for (;;) {
        const { state } = await control.request(
          ClientStatusResponseSchema,
          "GET",
          `/clients/${name}`,
        );
        if (state.connected && state["clientLoaded"] === true) break;
        if (performance.now() > deadline)
          throw new Error(
            `Native client ${name} did not complete the initial world loading handshake`,
          );
        await Bun.sleep(100);
      }
    }
  } catch (error) {
    await control.request(
      SandboxDownResponseSchema,
      "DELETE",
      `/sandboxes/${server.id}`,
    );
    throw error;
  }
  return {
    target: server.id,
    prepare: async (scenario: SuiteScenario) => {
      const [x, y, zz] = scenario.anchor;
      const [sx, sy, sz] = scenario.scene.staging;
      if (scenario.siteMode === undefined) {
        const minX = x + Math.floor(scenario.scene.bounds.min[0]);
        const minZ = zz + Math.floor(scenario.scene.bounds.min[2]);
        const maxX = x + Math.ceil(scenario.scene.bounds.max[0]);
        const maxZ = zz + Math.ceil(scenario.scene.bounds.max[2]);
        const staging = {
          x: x + Math.floor(sx),
          y: y + Math.floor(sy),
          z: zz + Math.floor(sz),
        };
        const result = await transport.world(WeRunResponseSchema, "we", {
          world: scenario.world,
          session: "suite-bench",
          ops: [
            {
              command: "//set minecraft:air",
              pos1: { x: minX, y, z: minZ },
              pos2: {
                x: maxX,
                y: y + Math.max(3, scenario.scene.bounds.max[1]),
                z: maxZ,
              },
            },
            {
              command: "//set minecraft:grass_block",
              pos1: { x: minX, y: y - 1, z: minZ },
              pos2: { x: maxX, y: y - 1, z: maxZ },
            },
            {
              command: "//set minecraft:grass_block",
              pos1: { ...staging, y: staging.y - 1 },
              pos2: { ...staging, y: staging.y - 1 },
            },
            {
              command: "//set minecraft:air",
              pos1: staging,
              pos2: { ...staging, y: staging.y + 1 },
            },
          ],
        });
        if (result.results.some((op) => !op.ok))
          throw new Error("Demo bench preparation failed");
      }
      const world = `minecraft:${worldFolder(scenario.world)}`;
      if (scenario.arrivalCommand !== undefined) {
        await enterWorld(transport, scenario.arrivalCommand, world);
      }
      await consoleCommand(
        `minecraft:execute in ${world} run minecraft:tp XiguaJerred ${coordinate(x + sx)} ${coordinate(y + sy)} ${coordinate(zz + sz)}`,
      );
      const deadline = performance.now() + 30_000;
      for (;;) {
        const { state } = await transport.request(
          ClientStatusResponseSchema,
          "GET",
          "/clients/XiguaJerred",
        );
        if (
          state.connected &&
          state.world === world &&
          state["terrainReady"] === true &&
          Math.abs(state.position[0] - (x + sx)) < 0.5 &&
          Math.abs(state.position[1] - (y + sy)) < 0.001 &&
          Math.abs(state.position[2] - (zz + sz)) < 0.5
        )
          break;
        if (performance.now() > deadline)
          throw new Error(
            `Native camera did not acknowledge the demo arrival: ${JSON.stringify({ expected: { world, position: [x + sx, y + sy, zz + sz] }, observed: state.connected ? { world: state.world, position: state.position, screen: state.screen, terrainReady: state["terrainReady"], clientLoaded: state["clientLoaded"] } : state })}`,
          );
        await Bun.sleep(100);
      }
      for (const name of ["XiguaJerred", ...input.helpers])
        await consoleCommand(`eco set ${name} 500`);
      await transport.request(
        z.object({ result: z.unknown() }),
        "POST",
        "/clients/XiguaJerred/close",
        {},
      );
    },
    stop: () =>
      control.request(
        SandboxDownResponseSchema,
        "DELETE",
        `/sandboxes/${server.id}`,
      ),
  };
}
