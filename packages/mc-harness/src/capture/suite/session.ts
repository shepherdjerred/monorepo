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
    for (const name of ["XiguaJerred", ...input.helpers])
      await control.request(ClientStatusResponseSchema, "POST", "/clients", {
        target: server.id,
        name,
        op: true,
        gameMode: "CREATIVE",
      });
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
      if (scenario.siteMode !== "preserve") {
        const result = await transport.world(WeRunResponseSchema, "we", {
          world: scenario.world,
          session: "suite-bench",
          ops: [
            {
              command: "//set minecraft:air",
              pos1: { x: x - 5, y, z: zz - 12 },
              pos2: { x: x + 20, y: y + 12, z: zz + 20 },
            },
            {
              command: "//set minecraft:stone_bricks",
              pos1: { x: x - 5, y: y - 1, z: zz - 12 },
              pos2: { x: x + 20, y: y - 1, z: zz + 20 },
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
        `minecraft:execute in ${world} run minecraft:tp XiguaJerred ${(x - 2.5).toString()} ${y.toString()} ${(zz - 2.5).toString()}`,
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
          Math.abs(state.position[0] - (x - 2.5)) < 0.5 &&
          Math.abs(state.position[1] - y) < 0.5 &&
          Math.abs(state.position[2] - (zz - 2.5)) < 0.5
        )
          break;
        if (performance.now() > deadline)
          throw new Error("Native camera did not acknowledge the demo arrival");
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
