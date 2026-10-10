import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { serverLogs } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { freezeInputs } from "./inputs.ts";
import { root, mapServerConfig } from "./paper.ts";

const args = parseArgs({
  strict: true,
  options: { output: { type: "string" } },
});
const output = path.resolve(z.string().min(1).parse(args.values.output));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const inputs = await freezeInputs(root, output);
const Status = z.strictObject({
  state: z.enum(["idle", "running", "passed", "failed"]),
  mode: z.string(),
  ticks: z.number().int().nonnegative(),
  position: z.array(z.number()),
  maximumY: z.number(),
  interactions: z.number().int().nonnegative(),
  doorOpen: z.boolean(),
  physics: z.array(
    z.strictObject({
      tick: z.number().int(),
      y: z.number(),
      vy: z.number(),
      inWater: z.boolean(),
      feet: z.string(),
      head: z.string(),
      controlInWater: z.boolean(),
      width: z.number(),
      height: z.number(),
      stepHeight: z.number(),
    }),
  ),
});

async function waitForTraversal(console: RconClient, mode: string) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const state = Status.parse(
      JSON.parse(await console.command("storm-fixture-navigation status")),
    );
    if (state.mode !== mode)
      throw new Error("Native navigation case identity changed");
    if (state.state === "passed" || state.state === "failed") {
      const missingEffects =
        state.position.length !== 3 ||
        (mode === "door" && (!state.doorOpen || state.interactions < 1)) ||
        (mode === "door-denied" && (state.doorOpen || state.interactions < 1));
      if (missingEffects && state.state === "passed")
        throw new Error(`Native ${mode} omitted its required effects`);
      return state;
    }
    await Bun.sleep(500);
  }
  throw new Error(`Native ${mode} timed out`);
}
const token = randomBytes(24).toString("hex");
const brain = startFakeBrain(token);
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let rcon: RconClient | undefined;
try {
  server = await startServer({
    cacheDir: path.join(root, ".cache/e2e/map-navigation"),
    bootTimeoutMs: 600_000,
    warmCache: true,
    ...(await mapServerConfig(inputs)),
    brain: {
      baseUrl: `http://host.docker.internal:${brain.port.toString()}`,
      token,
    },
    env: {},
    resources: { cpus: 4, heap: "4G", memoryLimit: "6g" },
  });
  if (server.info.kind !== "container")
    throw new Error("Native navigation proof needs an owned container");
  rcon = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  const results: z.infer<typeof Status>[] = [];
  const failures: string[] = [];
  for (const mode of ["door", "door-denied", "ladder", "leap", "water"]) {
    await inputs.check();
    Status.parse(
      JSON.parse(await rcon.command(`storm-fixture-navigation start ${mode}`)),
    );
    const state = await waitForTraversal(rcon, mode);
    results.push(state);
    await Bun.write(
      path.join(output, "results.json"),
      JSON.stringify(
        {
          schema: 1,
          kind: "rwf-native-navigation-proof",
          container: server.info.containerId,
          producer: inputs.hashes,
          results,
        },
        null,
        2,
      ) + "\n",
    );
    console.warn(`Native traversal ${state.state}: ${mode}`);
    if (state.state === "failed") failures.push(mode);
    if (
      state.physics.length === 0 ||
      state.physics.some((sample) => sample.stepHeight !== 0.6)
    )
      failures.push(
        `${mode} player step height: ${state.physics.map((sample) => sample.stepHeight).join(",")}`,
      );
  }
  await inputs.check();
  if (failures.length > 0)
    throw new Error(
      `Native traversal failed: ${failures.join(", ")}; see results.json physics`,
    );
} finally {
  try {
    if (server !== undefined)
      await Bun.write(
        path.join(output, "server.log"),
        await serverLogs(server.info),
      );
  } finally {
    rcon?.close();
    try {
      await server?.stop();
    } finally {
      await brain.stop();
    }
  }
}
