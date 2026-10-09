import { randomBytes } from "node:crypto";
import path from "node:path";
import { stormModuleConfig } from "@shepherdjerred/mc-harness/sandbox/storm.ts";
import {
  docker,
  serverLogs,
} from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { ExportState, type legacyMap } from "./legacy.ts";
import type { ConversionInputs } from "./inputs.ts";

export const root = path.resolve(import.meta.dirname, "../..");

/** Every import gets its own world copy and Paper owner; no production connection. */
export async function exportTerrain(
  output: string,
  map: ReturnType<typeof legacyMap>,
  inputs: ConversionInputs,
) {
  const token = randomBytes(24).toString("hex");
  const brain = startFakeBrain(token);
  const brainUrl = `http://host.docker.internal:${brain.port.toString()}`;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let console: RconClient | undefined;
  try {
    const content = inputs.content;
    server = await startServer({
      cacheDir: path.join(root, ".cache/e2e/map-import"),
      bootTimeoutMs: 600_000,
      warmCache: true,
      worldDir: path.join(output, "world"),
      exportWorldDir: path.join(output, "converted-world"),
      stormJar: inputs.stormJar,
      fixturesJar: inputs.fixturesJar,
      mapSourceChunks: path.join(output, "source-chunks.json"),
      ownedConfigDir: content,
      stormConfig: stormModuleConfig(
        await Bun.file(path.join(content, "config.yml")).text(),
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
      env: {},
      resources: { cpus: 4, heap: "8G", memoryLimit: "10g" },
    });
    if (server.info.kind !== "container")
      throw new Error("Map conversion needs an owned container");
    console = await RconClient.connect({
      host: server.info.host,
      port: server.info.rconPort,
      password: server.info.rconPassword,
    });
    const { minX, minZ, maxX, maxZ } = map.bounds;
    ExportState.parse(
      JSON.parse(
        await console.command(
          `storm-fixture-map-export start ${[minX, minZ, maxX, maxZ, map.requiredY].join(" ")}`,
        ),
      ),
    );
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
      const state = ExportState.parse(
        JSON.parse(await console.command("storm-fixture-map-export status")),
      );
      if (state.state === "failed")
        throw new Error(`Native terrain export failed: ${state.message}`);
      if (state.state === "complete") {
        await docker([
          "cp",
          `${server.info.containerId}:/data/plugins/TheStormFixtures/map-export/.`,
          output,
        ]);
        await Bun.write(
          path.join(output, "native-export.json"),
          JSON.stringify(state, null, 2) + "\n",
        );
        return state;
      }
      await Bun.sleep(1000);
    }
    throw new Error("Native map export exceeded ten minutes");
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
