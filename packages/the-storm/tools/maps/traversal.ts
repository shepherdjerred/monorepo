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
import {
  TraversalStatus,
  traversalContract,
  summarizeTraversal,
  compareFlatTraversal,
} from "./traversal-wire.ts";

const args = parseArgs({
  strict: true,
  options: {
    output: { type: "string" },
    scenario: { type: "string", multiple: true },
    repetitions: { type: "string", default: "3" },
    driver: { type: "string", default: "motor" },
  },
});
const output = path.resolve(z.string().min(1).parse(args.values.output));
const repetitions = z.coerce
  .number()
  .int()
  .min(1)
  .max(10)
  .parse(args.values.repetitions);
const driver = z.enum(["motor", "graph"]).parse(args.values.driver);
const requested = z.array(z.string()).parse(args.values.scenario ?? []);
for (const id of requested)
  if (!traversalContract.scenarios.some((scenario) => scenario.id === id))
    throw new Error(`Unknown traversal scenario ${id}`);
const scenarios = traversalContract.scenarios.filter(
  (scenario) => requested.length === 0 || requested.includes(scenario.id),
);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const inputs = await freezeInputs(root, output);
await Bun.write(
  path.join(output, "contract.json"),
  JSON.stringify(traversalContract, null, 2) + "\n",
);
const token = randomBytes(24).toString("hex");
const brain = startFakeBrain(token);
const brainUrl = `http://host.docker.internal:${brain.port.toString()}`;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let connection: RconClient | undefined;
const results: {
  repetition: number;
  summary: ReturnType<typeof summarizeTraversal>;
}[] = [];
const failures: string[] = [];
async function waitForTrial(rcon: RconClient, id: string, repetition: number) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const latest = TraversalStatus.parse(
      JSON.parse(await rcon.command("storm-fixture-traversal status")),
    );
    if (latest.scenario !== id)
      throw new Error("Traversal trial identity changed");
    // Each trial owns its file. Failed/timed-out observations are never replaced by a rerun.
    await Bun.write(
      path.join(output, `${id}-${repetition.toString()}.json`),
      JSON.stringify(latest, null, 2) + "\n",
    );
    if (latest.state === "passed" || latest.state === "failed") return latest;
    await Bun.sleep(500);
  }
  throw new Error(`Native trial timed out: ${id}`);
}
try {
  server = await startServer({
    cacheDir: path.join(root, ".cache/e2e/traversal"),
    dataDir: path.join(output, "server-data"),
    bootTimeoutMs: 600_000,
    warmCache: true,
    ...(await mapServerConfig(inputs, { baseUrl: brainUrl, token })),
    resources: { cpus: 4, heap: "4G", memoryLimit: "6g" },
  });
  if (server.info.kind !== "container")
    throw new Error("Traversal calibration needs owned disposable container");
  connection = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  const rcon = connection;
  const nativeContract: unknown = JSON.parse(
    await rcon.command("storm-fixture-traversal contract"),
  );
  if (JSON.stringify(nativeContract) !== JSON.stringify(traversalContract))
    throw new Error(
      "Frozen native producer uses a different traversal contract",
    );
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const scenario of scenarios) {
      await inputs.check();
      const command = driver === "graph" ? "start-route" : "start";
      TraversalStatus.parse(
        JSON.parse(
          await rcon.command(
            `storm-fixture-traversal ${command} ${scenario.id}`,
          ),
        ),
      );
      const latest = await waitForTrial(rcon, scenario.id, repetition);
      const summary = summarizeTraversal(latest);
      results.push({ repetition, summary });
      if (!summary.reached)
        failures.push(`${scenario.id}/${repetition.toString()}`);
      await Bun.write(
        path.join(output, "results.json"),
        JSON.stringify(
          {
            schema: 1,
            kind: "rwf-native-traversal-calibration",
            driver,
            container: server.info.containerId,
            producer: inputs.hashes,
            units: {
              time: "server-ticks",
              velocity: "blocks-per-tick",
              damage: "health-points",
            },
            repetitions,
            results,
            failures,
          },
          null,
          2,
        ) + "\n",
      );
      console.warn(
        `${scenario.id}/${repetition.toString()}: ${latest.state} in ${summary.driveTicks.toString()} driven ticks, damage ${summary.damage.toString()}`,
      );
    }
  }
  await inputs.check();
  if (failures.length > 0)
    throw new Error(
      `Native traversal failures: ${failures.join(", ")}; observations retained in ${output}`,
    );
  const comparison =
    driver === "motor"
      ? compareFlatTraversal(results.map((result) => result.summary))
      : undefined;
  await Bun.write(
    path.join(output, "flat-comparison.json"),
    JSON.stringify({ schema: 1, comparison: comparison ?? null }, null, 2) +
      "\n",
  );
} catch (error) {
  await Bun.write(
    path.join(output, "failure.json"),
    JSON.stringify(
      {
        message: error instanceof Error ? error.message : String(error),
        results,
        failures,
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  try {
    if (server !== undefined)
      await Bun.write(
        path.join(output, "server.log"),
        await serverLogs(server.info),
      );
  } finally {
    connection?.close();
    try {
      await server?.stop();
    } finally {
      await brain.stop();
    }
  }
}
