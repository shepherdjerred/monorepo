import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { stormModuleConfig } from "@shepherdjerred/mc-harness/sandbox/storm.ts";
import {
  docker,
  serverLogs,
} from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import type { MapContent } from "#learning/maps/scenario.ts";
import type { ConversionInputs } from "./inputs.ts";
import { root } from "./paper.ts";

const State = z.discriminatedUnion("state", [
  z.strictObject({ state: z.enum(["idle", "reading", "encoding"]) }),
  z.strictObject({ state: z.literal("failed"), message: z.string() }),
  z.strictObject({
    state: z.literal("complete"),
    containers: z.number().int().nonnegative(),
    signs: z.number().int().nonnegative(),
  }),
]);

/** Extract inventories through Paper's versioned item API, and signs as literal text only. */
export async function exportDetails(
  source: string,
  output: string,
  selection: { map: MapContent; originalMin: { x: number; z: number } },
  inputs: ConversionInputs,
) {
  const { map, originalMin } = selection;
  const token = randomBytes(24).toString("hex");
  const brain = startFakeBrain(token);
  const brainUrl = `http://host.docker.internal:${brain.port.toString()}`;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let console: RconClient | undefined;
  try {
    server = await startServer({
      cacheDir: path.join(root, ".cache/e2e/map-details"),
      bootTimeoutMs: 600_000,
      warmCache: true,
      worldDir: path.join(source, "converted-world"),
      mapSourceChunks: path.join(source, "source-chunks.json"),
      stormJar: inputs.stormJar,
      fixturesJar: inputs.fixturesJar,
      ownedConfigDir: inputs.content,
      stormConfig: stormModuleConfig(
        await Bun.file(path.join(inputs.content, "config.yml")).text(),
        [],
      ),
      sweep: {
        intervalMinutes: 1,
        redriveAfterMinutes: 0,
        redriveBackoffMinutes: 0,
        slaAfterMinutes: 10_080,
      },
      agent: { mode: "shadow", reviewSamplePercent: 100 },
      brain: { baseUrl: brainUrl, token },
      env: { ENABLE_COMMAND_BLOCK: "FALSE" },
      resources: { cpus: 4, heap: "8G", memoryLimit: "10g" },
    });
    if (server.info.kind !== "container")
      throw new Error("Map details export needs an owned container");
    console = await RconClient.connect({
      host: server.info.host,
      port: server.info.rconPort,
      password: server.info.rconPassword,
    });
    const bounds = [
      originalMin.x,
      map.region.min.y,
      originalMin.z,
      originalMin.x + map.region.max.x - map.region.min.x,
      map.region.max.y,
      originalMin.z + map.region.max.z - map.region.min.z,
      map.blocksSha256,
    ];
    State.parse(
      JSON.parse(
        await console.command(
          `storm-fixture-map-details start ${bounds.join(" ")}`,
        ),
      ),
    );
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
      const state = State.parse(
        JSON.parse(await console.command("storm-fixture-map-details status")),
      );
      if (state.state === "failed") throw new Error(state.message);
      if (state.state === "complete") {
        await docker([
          "cp",
          `${server.info.containerId}:/data/plugins/TheStormFixtures/map-details/.`,
          output,
        ]);
        return state;
      }
      await Bun.sleep(1000);
    }
    throw new Error("Native map details export exceeded ten minutes");
  } finally {
    try {
      if (server !== undefined)
        await Bun.write(
          path.join(output, "server.log"),
          await serverLogs(server.info),
        );
    } finally {
      console?.close();
      try {
        await server?.stop();
      } finally {
        await brain.stop();
      }
    }
  }
}
