import { randomBytes } from "node:crypto";
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { paper } from "@shepherdjerred/mc-harness/pins.ts";
import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { serverLogs } from "#e2e/harness/external/files.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import {
  MapContent,
  MapScenario,
  validateScenario,
} from "#learning/maps/scenario.ts";
import { terrainHash } from "#maps/author.ts";
import { bindDetailsProvenance, Details } from "#maps/content/shops.ts";
import { freezeInputs } from "#maps/inputs.ts";
import { mapServerConfig, root } from "#maps/paper.ts";
import { MapConnectionResult, MapConnectionStatus } from "./wire.ts";

const args = parseArgs({
  strict: true,
  options: {
    output: { type: "string" },
    install: { type: "boolean", default: false },
  },
});
const output = path.resolve(z.string().min(1).parse(args.values.output));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
async function run(argv: string[], log: string) {
  const child = Bun.spawn(argv, {
    cwd: root,
    stdout: Bun.file(log),
    stderr: Bun.file(`${log}.stderr`),
  });
  if ((await child.exited) !== 0) throw new Error(`Command failed: ${log}`);
}
await run(
  [
    "mise",
    "exec",
    "--",
    "gradle",
    "-p",
    "plugin",
    ":dist:assemble",
    ":rwfmap:installDist",
    "--console=plain",
  ],
  path.join(output, "build.log"),
);
const inputs = await freezeInputs(root, output);
const token = randomBytes(24).toString("hex");
const brain = startFakeBrain(token);
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let rcon: RconClient | undefined;
try {
  server = await startServer({
    ...(await mapServerConfig(inputs, {
      baseUrl: `http://host.docker.internal:${brain.port.toString()}`,
      token,
    })),
    cacheDir: path.join(root, ".cache/e2e/map-connections"),
    warmCache: true,
    bootTimeoutMs: 600_000,
    resources: { cpus: 4, heap: "8G", memoryLimit: "10g" },
  });
  if (server.info.kind !== "container")
    throw new Error("Connections require an owned container");
  await Bun.write(
    path.join(output, "runtime.json"),
    JSON.stringify(
      {
        provider: "docker",
        containerId: server.info.containerId,
        paperVersion: paper.version,
        paperBuild: paper.build,
        paperSha256: paper.sha256,
      },
      null,
      2,
    ) + "\n",
  );
  rcon = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  await rcon.command("storm-fixture-map-connections start");
  const deadline = Date.now() + 600_000;
  for (;;) {
    const state = MapConnectionStatus.parse(
      JSON.parse(await rcon.command("storm-fixture-map-connections status")),
    );
    if (state.state === "failed") throw new Error(state.message);
    if (state.state === "complete") break;
    if (Date.now() > deadline)
      throw new Error("Map connection conversion timed out");
    await Bun.sleep(1000);
  }
  await mkdir(path.join(output, "native"));
  await docker([
    "cp",
    `${server.info.containerId}:/data/plugins/TheStormFixtures/map-connections/.`,
    path.join(output, "native"),
  ]);
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
await inputs.check();
const results = z
  .array(MapConnectionResult)
  .parse(await Bun.file(path.join(output, "native/results.json")).json());
const maps = path.join(root, "server/owned/plugins/TheStorm/rwf/maps");
const folders = await readdir(maps, { withFileTypes: true });
const ids = folders
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (JSON.stringify(ids) !== JSON.stringify(results.map((result) => result.id)))
  throw new Error("Native conversion omitted or repeated catalog entries");
const Registry = z.object({
  schema: z.literal(1),
  kind: z.string(),
  scenarios: z.array(MapScenario),
});
const registryFiles = [
  path.join(
    root,
    "plugin/modules/rwfbots/src/main/resources/rwf-map-scenarios.json",
  ),
  path.join(root, "tools/learning/maps/training-scenarios.json"),
];
const registries = await Promise.all(
  registryFiles.map(async (file) => ({
    file,
    value: Registry.parse(await Bun.file(file).json()),
  })),
);
const producer = inputs.hashes.find(
  (entry) => entry.file === "TheStormFixtures.jar",
);
if (producer === undefined) throw new Error("Missing frozen map converter");
const fixturesSha256 = producer.sha256;
const installs: { staged: string; installed: string }[] = [];
async function stage(result: z.infer<typeof MapConnectionResult>) {
  console.warn(`${result.id}: ${result.changed.toString()} repaired blocks`);
  if (result.changed === 0 || !args.values.install) return;
  const installed = path.join(maps, result.id);
  const folder = path.join(output, "staged", result.id);
  await cp(installed, folder, { recursive: true });
  const receipt = {
    policy: "native-neighbor-shapes",
    ...result,
    fixturesSha256,
    paperVersion: paper.version,
    paperBuild: paper.build,
    paperSha256: paper.sha256,
    secondPassChanged: 0,
  };
  const metadataFile = path.join(folder, "map.yml");
  const metadataText = await Bun.file(metadataFile).text();
  const metadata = MapContent.parse(Bun.YAML.parse(metadataText));
  const details = Details.parse(
    await Bun.file(path.join(folder, "details.json")).json(),
  );
  const encoded = await Bun.file(
    path.join(output, "native", `${result.id}.schem`),
  ).bytes();
  const decoded = await readSchematic(encoded);
  const original = await readSchematic(
    await Bun.file(path.join(folder, "blocks.schem")).bytes(),
  );
  if (
    metadata.blocksSha256 !== result.before ||
    details.blocksSha256 !== result.before ||
    terrainHash(original.grid) !== result.before ||
    terrainHash(decoded.grid) !== result.after
  )
    throw new Error(`Stale terrain binding: ${result.id}`);
  await Bun.write(path.join(folder, "blocks.schem"), encoded);
  const updated = { ...metadata, blocksSha256: result.after };
  await Bun.write(
    metadataFile,
    metadataText.replace(result.before, result.after),
  );
  await Bun.write(
    path.join(folder, "details.json"),
    JSON.stringify({ ...details, blocksSha256: result.after }, null, 2) + "\n",
  );
  const sourceFile = path.join(folder, "source.json");
  const source = z
    .record(z.string(), z.unknown())
    .parse(await Bun.file(sourceFile).json());
  await Bun.write(
    sourceFile,
    JSON.stringify(
      {
        ...source,
        connectionRepair: receipt,
      },
      null,
      2,
    ) + "\n",
  );
  const provenanceFile = path.join(folder, "details.provenance.json");
  const provenance = z
    .record(z.string(), z.unknown())
    .parse(await Bun.file(provenanceFile).json());
  await Bun.write(
    provenanceFile,
    JSON.stringify(
      {
        ...provenance,
        blocksSha256: result.after,
        detailsSha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file(path.join(folder, "details.json")).bytes())
          .digest("hex"),
        connectionRepair: receipt,
      },
      null,
      2,
    ) + "\n",
  );
  await bindDetailsProvenance(folder);
  const removalFile = path.join(folder, "removed-shops.json");
  if (await Bun.file(removalFile).exists()) {
    const removal = z
      .record(z.string(), z.unknown())
      .parse(await Bun.file(removalFile).json());
    if (removal["blocksSha256"] !== result.before)
      throw new Error(`Stale shop-removal binding: ${result.id}`);
    await Bun.write(
      removalFile,
      JSON.stringify(
        {
          ...removal,
          shopRemovalBlocksSha256:
            removal["shopRemovalBlocksSha256"] ?? result.before,
          blocksSha256: result.after,
          connectionRepair: receipt,
        },
        null,
        2,
      ) + "\n",
    );
  }
  const scenarioFile = path.join(folder, "scenario.json");
  const scenario = MapScenario.parse(await Bun.file(scenarioFile).json());
  const rebound = { ...scenario, mapSha256: result.after };
  validateScenario(rebound, updated);
  await Bun.write(scenarioFile, JSON.stringify(rebound, null, 2) + "\n");
  for (const registry of registries) {
    const match = registry.value.scenarios.find(
      (candidate) => candidate.map === result.id,
    );
    if (match === undefined) throw new Error(`Missing scenario: ${result.id}`);
    match.mapSha256 = result.after;
    validateScenario(match, updated);
  }
  for (const action of ["bake", "verify-details", "verify"]) {
    await run(
      [
        "mise",
        "exec",
        "--",
        path.join(inputs.mapTool, "bin/rwfmap"),
        action,
        folder,
      ],
      path.join(output, `${result.id}-${action}.log`),
    );
  }
  installs.push({ staged: folder, installed });
}
const queue = [...results];
async function stageNext() {
  for (;;) {
    const result = queue.shift();
    if (result === undefined) return;
    await stage(result);
  }
}
const stages = await Promise.allSettled(
  Array.from({ length: 3 }, () => stageNext()),
);
for (const stageResult of stages) {
  if (stageResult.status === "rejected") throw stageResult.reason;
}
if (args.values.install) {
  // Publish only after every staged map has passed payload, scenario and navigation checks.
  for (const install of installs)
    for (const file of [
      "blocks.schem",
      "map.yml",
      "details.json",
      "details.provenance.json",
      "source.json",
      "scenario.json",
      "nav.rwfnav",
      "nav.summary.json",
    ])
      await cp(
        path.join(install.staged, file),
        path.join(install.installed, file),
      );
  for (const install of installs) {
    const receipt = path.join(install.staged, "removed-shops.json");
    if (await Bun.file(receipt).exists())
      await cp(receipt, path.join(install.installed, "removed-shops.json"));
  }
  for (const registry of registries)
    await Bun.write(
      registry.file,
      JSON.stringify(registry.value, null, 2) + "\n",
    );
}
