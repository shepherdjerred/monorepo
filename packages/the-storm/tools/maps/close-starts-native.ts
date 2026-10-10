import { randomBytes } from "node:crypto";
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { z } from "zod";
import { serverLogs } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { status } from "#e2e/harness/rwf-match.ts";
import { closeScenario } from "#learning/maps/close-starts.ts";
import { MapContent, MapScenario } from "#learning/maps/scenario.ts";
import { freezeInputs } from "./inputs.ts";
import { Lifecycle, verifyBounds } from "./lifecycle.ts";
import { root, runtimeMapServerConfig, waitForMapState } from "./paper.ts";

const args = parseArgs({
  strict: true,
  options: {
    maps: { type: "string" },
    output: { type: "string" },
    map: { type: "string", multiple: true },
  },
});
const required = (value: unknown) =>
  path.resolve(z.string().min(1).parse(value));
const source = required(args.values.maps);
const output = required(args.values.output);
const listing = await readdir(source, { withFileTypes: true });
const available = listing
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const selected = args.values.map ?? available;
if (
  selected.length < 3 ||
  new Set(selected).size !== selected.length ||
  selected.some((id) => !available.includes(id))
)
  throw new Error(
    "Native close-start proof needs at least three distinct authored maps",
  );
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const inputs = await freezeInputs(root, output);
const content = path.join(output, "plugins/TheStorm");
await cp(inputs.content, content, {
  recursive: true,
  filter: (entry) => entry !== path.join(inputs.content, "rwf/maps"),
});
await cp(
  path.join(path.dirname(inputs.content), "Citizens"),
  path.join(path.dirname(content), "Citizens"),
  { recursive: true },
);
const maps = path.join(content, "rwf/maps");
await mkdir(maps);
const scenarios = new Map<string, MapScenario>();
for (const id of selected) {
  const target = path.join(maps, id);
  await cp(path.join(source, id), target, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const metadata = MapContent.parse(
    Bun.YAML.parse(await Bun.file(path.join(target, "map.yml")).text()),
  );
  const scenario = MapScenario.parse(
    await Bun.file(path.join(target, "scenario.json")).json(),
  );
  const receipt: unknown = await Bun.file(
    path.join(target, "close-starts.json"),
  ).json();
  if (
    metadata.id !== id ||
    !isDeepStrictEqual(closeScenario(metadata, receipt), scenario)
  )
    throw new Error(
      "Native candidate differs from its offline geometry receipt",
    );
  scenarios.set(id, scenario);
}
const inventory = await readdir(maps, { recursive: true, withFileTypes: true });
const assets = await Promise.all(
  inventory
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return {
        file: path.relative(maps, file),
        sha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file(file).arrayBuffer())
          .digest("hex"),
      };
    }),
);
await Bun.write(
  path.join(output, "assets.json"),
  JSON.stringify(assets, null, 2) + "\n",
);
const Native = z.strictObject({
  state: z.enum(["idle", "running", "passed", "failed"]),
  map: z.string(),
  blocksSha256: z.string(),
  ticks: z.number().int().nonnegative(),
  legs: z.number().int().nonnegative(),
  geometry: z.boolean(),
  starts: z.array(
    z.strictObject({
      x: z.number(),
      y: z.number(),
      z: z.number(),
      yaw: z.number().transform(Math.fround),
    }),
  ),
  samples: z.array(
    z.strictObject({
      tick: z.number().int(),
      actor: z.number().int(),
      legs: z.number().int(),
      position: z.tuple([z.number(), z.number(), z.number()]),
      vy: z.number(),
      grounded: z.boolean(),
      width: z.number(),
      height: z.number(),
      stepHeight: z.number(),
    }),
  ),
  message: z.string(),
});
const token = randomBytes(24).toString("hex");
const brain = startFakeBrain(token);
const brainUrl = `http://host.docker.internal:${brain.port.toString()}`;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let rcon: RconClient | undefined;
const results: z.infer<typeof Native>[] = [];
const visited: string[] = [];
const snapshots: Lifecycle[] = [];
const deadline = Date.now() + 2_700_000;
try {
  server = await startServer({
    cacheDir: path.join(root, ".cache/e2e/learning"),
    bootTimeoutMs: 180_000,
    warmCache: true,
    ...(await runtimeMapServerConfig(inputs, content, {
      baseUrl: brainUrl,
      token,
    })),
  });
  rcon = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  const console = rcon;
  async function observe() {
    if (Date.now() >= deadline)
      throw new Error("Native close-start owner exceeded 45 minutes");
    const snapshot = Lifecycle.parse(
      JSON.parse(await console.command("storm-fixture-map-lifecycle status")),
    );
    verifyBounds(snapshot);
    snapshots.push(snapshot);
    await Bun.write(
      path.join(output, "snapshots.json"),
      JSON.stringify(snapshots, null, 2) + "\n",
    );
  }
  const wait = (check: () => Promise<boolean>, description: string) =>
    waitForMapState(deadline, observe, check, description);
  await wait(async () => {
    const s = await status(console);
    return s.ready && s.phase === "Lobby";
  }, "initial original map preparation");
  for (let round = 0; round < selected.length * 8; round++) {
    const match = await status(console);
    visited.push(match.map);
    const scenario = scenarios.get(match.map);
    if (scenario === undefined)
      throw new Error("Native rotation selected an unstaged map");
    if (!results.some((result) => result.map === match.map)) {
      const expectedStarts = scenario.spawns.map((spawn) => ({
        x: spawn.position[0],
        y: spawn.position[1],
        z: spawn.position[2],
        yaw: spawn.yaw,
      }));
      const coordinates = scenario.spawns.flatMap((spawn) => [
        ...spawn.position,
        spawn.yaw,
      ]);
      Native.parse(
        JSON.parse(
          await console.command(
            `storm-fixture-close-starts start ${scenario.map} ${scenario.mapSha256} ${coordinates.join(" ")}`,
          ),
        ),
      );
      let terminal: z.infer<typeof Native> | undefined;
      await wait(async () => {
        const sample = Native.parse(
          JSON.parse(
            await console.command("storm-fixture-close-starts status"),
          ),
        );
        if (
          sample.map !== scenario.map ||
          sample.blocksSha256 !== scenario.mapSha256 ||
          !isDeepStrictEqual(sample.starts, expectedStarts)
        )
          throw new Error("Native close-start identity changed");
        await Bun.write(
          path.join(output, `${scenario.map}.json`),
          JSON.stringify(sample, null, 2) + "\n",
        );
        if (sample.state === "passed" || sample.state === "failed") {
          terminal = sample;
          return true;
        }
        return false;
      }, `both native round trips on ${scenario.map}`);
      if (terminal === undefined)
        throw new Error("Native traversal omitted a terminal report");
      const completed = terminal;
      results.push(completed);
      if (
        completed.state !== "passed" ||
        !completed.geometry ||
        completed.legs !== 4 ||
        ![0, 1].every((actor) =>
          completed.samples.some((sample) => sample.actor === actor),
        ) ||
        completed.samples.some(
          (sample) =>
            Math.abs(sample.width - 0.6) > 0.0001 ||
            Math.abs(sample.height - 1.8) > 0.0001 ||
            sample.stepHeight !== 0.6,
        )
      )
        throw new Error(
          `Native close-start admission failed for ${scenario.map}: ${completed.message}`,
        );
      globalThis.console.warn(
        `Native original-map close starts passed: ${scenario.map}`,
      );
    }
    if (results.length === selected.length) break;
    await console.command("storm-fixture-map-lifecycle start");
    await wait(async () => {
      const s = await status(console);
      return s.ready && s.phase === "Live";
    }, "ordinary showcase start");
    await console.command("storm-fixture-map-lifecycle stop");
    await wait(async () => {
      const s = await status(console);
      return s.ready && s.phase === "Lobby" && s.map !== match.map;
    }, "ordinary successor preparation");
  }
  if (results.length !== selected.length)
    throw new Error(
      "Bounded ordinary rotation did not visit every requested candidate",
    );
  await inputs.check();
  for (const asset of assets)
    if (
      new Bun.CryptoHasher("sha256")
        .update(await Bun.file(path.join(maps, asset.file)).arrayBuffer())
        .digest("hex") !== asset.sha256
    )
      throw new Error("Native close-start map input changed");
  await Bun.write(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        schema: 1,
        kind: "rwf-native-close-starts",
        acceptance: "unaccepted",
        rolloutEnabled: false,
        selected,
        visited,
        results,
        peakDecoded: Math.max(
          ...snapshots.map((s) => s.maps.filter((map) => map.decoded).length),
        ),
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  await Bun.write(
    path.join(output, "failure.json"),
    JSON.stringify(
      {
        message: error instanceof Error ? error.message : String(error),
        visited,
        results,
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
    rcon?.close();
    try {
      await server?.stop();
    } finally {
      await brain.stop();
    }
  }
}
