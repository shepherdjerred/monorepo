import { randomBytes } from "node:crypto";
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { serverLogs } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { status } from "#e2e/harness/rwf-match.ts";
import { freezeInputs } from "./inputs.ts";
import { root, runtimeMapServerConfig, waitForMapState } from "./paper.ts";
import { Lifecycle, verifyBounds } from "./lifecycle.ts";

const args = parseArgs({
  strict: true,
  options: {
    maps: { type: "string" },
    output: { type: "string" },
    rotations: { type: "string", default: "3" },
    "require-map": { type: "string", multiple: true },
  },
});
const maps = path.resolve(z.string().min(1).parse(args.values.maps));
const output = path.resolve(z.string().min(1).parse(args.values.output));
const rotations = z.coerce
  .number()
  .int()
  .min(2)
  .max(12)
  .parse(args.values.rotations);
const requiredMaps = z
  .array(z.string().min(1))
  .parse(args.values["require-map"] ?? []);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { mode: 0o700 });
const inputs = await freezeInputs(root, output);
const content = path.join(output, "plugins/TheStorm");
await mkdir(content, { recursive: true });
for (const file of await readdir(inputs.content))
  if (file !== "rwf")
    await cp(path.join(inputs.content, file), path.join(content, file), {
      recursive: true,
    });
await mkdir(path.join(content, "rwf"));
for (const file of await readdir(path.join(inputs.content, "rwf")))
  if (file !== "maps")
    await cp(
      path.join(inputs.content, "rwf", file),
      path.join(content, "rwf", file),
      { recursive: true },
    );
await cp(maps, path.join(content, "rwf/maps"), { recursive: true });
await cp(
  path.join(path.dirname(inputs.content), "Citizens"),
  path.join(path.dirname(content), "Citizens"),
  { recursive: true },
);
const inventory = await readdir(maps, { recursive: true, withFileTypes: true });
const hashes = await Promise.all(
  inventory
    .filter((file) => file.isFile())
    .map(async (file) => ({
      file: path.relative(maps, path.join(file.parentPath, file.name)),
      sha256: new Bun.CryptoHasher("sha256")
        .update(
          await Bun.file(path.join(file.parentPath, file.name)).arrayBuffer(),
        )
        .digest("hex"),
    })),
);
await Bun.write(
  path.join(output, "assets.json"),
  JSON.stringify(hashes, null, 2) + "\n",
);
const token = randomBytes(24).toString("hex");
const brain = startFakeBrain(token);
const brainUrl = `http://host.docker.internal:${brain.port.toString()}`;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let console: RconClient | undefined;
const samples: Lifecycle[] = [];
const visited: string[] = [];
const verifiedContents = new Set<string>();
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
  console = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  const rcon = console;
  async function observe() {
    if (Date.now() >= deadline)
      throw new Error("Native lifecycle proof exceeded its owner deadline");
    const snapshot = Lifecycle.parse(
      JSON.parse(await rcon.command("storm-fixture-map-lifecycle status")),
    );
    verifyBounds(snapshot);
    samples.push(snapshot);
    await Bun.write(
      path.join(output, "samples.json"),
      JSON.stringify(samples, null, 2) + "\n",
    );
    return snapshot;
  }
  const wait = (check: () => Promise<boolean>, description: string) =>
    waitForMapState(deadline, observe, check, description);
  async function contents() {
    const snapshot = await observe();
    for (const map of snapshot.maps.filter((candidate) => candidate.ready)) {
      const expected = await Bun.file(
        path.join(maps, map.id, "details.json"),
      ).text();
      const encoded = Buffer.from(expected).toString("base64");
      const received = z.strictObject({ received: z.literal(true) });
      received.parse(
        JSON.parse(
          await rcon.command(
            `storm-fixture-map-lifecycle verify-contents-begin ${map.id}`,
          ),
        ),
      );
      // The pinned server reads RCON requests into a 1460-byte buffer, including framing.
      for (let offset = 0; offset < encoded.length; offset += 1024)
        received.parse(
          JSON.parse(
            await rcon.command(
              `storm-fixture-map-lifecycle verify-contents-append ${map.id} ${encoded.slice(offset, offset + 1024)}`,
            ),
          ),
        );
      z.strictObject({ matched: z.literal(true) }).parse(
        JSON.parse(
          await rcon.command(
            `storm-fixture-map-lifecycle verify-contents ${map.id}`,
          ),
        ),
      );
      verifiedContents.add(map.id);
    }
  }
  await observe();
  await wait(async () => {
    const s = await status(rcon);
    return s.ready && s.phase === "Lobby";
  }, "initial arena admission");
  const initial = await observe();
  for (const id of requiredMaps)
    if (!initial.maps.some((map) => map.id === id))
      throw new Error(`Unknown required runtime map: ${id}`);
  if (!initial.maps.some((map) => map.preparations === 0))
    throw new Error("Initial admission read every map");
  for (let round = 0; ; round++) {
    const before = await status(rcon);
    visited.push(before.map);
    await contents();
    if (round >= rotations && requiredMaps.every((id) => visited.includes(id)))
      break;
    if (round >= 12)
      throw new Error(
        "Ordinary rotation did not visit all required maps within twelve transitions",
      );
    await rcon.command("storm-fixture-map-lifecycle start");
    await wait(async () => {
      const s = await status(rcon);
      return s.ready && s.phase === "Live";
    }, "native bots to enter combat");
    await observe();
    await Bun.sleep(2000);
    await rcon.command("storm-fixture-map-lifecycle stop");
    await wait(async () => {
      const s = await status(rcon);
      return s.ready && s.phase === "Lobby" && s.map !== before.map;
    }, "rotation to a ready successor");
    await observe();
  }
  await wait(async () => {
    const snapshot = await observe();
    return snapshot.maps
      .filter((map) => !map.decoded && !map.busy)
      .every((map) => snapshot.loadedChunks[map.id] === 0);
  }, "inactive map chunks to unload");
  await inputs.check();
  for (const entry of hashes) {
    const hash = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(path.join(maps, entry.file)).arrayBuffer())
      .digest("hex");
    if (hash !== entry.sha256)
      throw new Error("Native proof map inputs changed");
  }
  const last = await observe();
  const released = last.maps.filter((map) => map.releases > 0);
  if (released.length === 0)
    throw new Error("No ordinary rotation released a map");
  const report = {
    schema: 1,
    kind: "rwf-native-map-lifecycle",
    acceptance: "unaccepted",
    rolloutEnabled: false,
    rotations: visited.length - 1,
    minimumRotations: rotations,
    requiredMaps,
    visited,
    verifiedContents: [...verifiedContents].sort(),
    catalogMaps: last.maps.length,
    samples: samples.length,
    peakDecoded: Math.max(
      ...samples.map((s) => s.maps.filter((m) => m.decoded).length),
    ),
    peakNavigation: Math.max(...samples.map((s) => s.navigation.length)),
    peakHeapBytes: Math.max(...samples.map((s) => s.heapUsed)),
    heapMaxBytes: last.heapMax,
    released: released.map((m) => ({
      id: m.id,
      preparations: m.preparations,
      releases: m.releases,
    })),
    maximumRollingP95TickMs: Math.max(
      ...samples.map((s) => {
        const times = s.tickTimes.filter((t) => t > 0).sort((a, b) => a - b);
        return (times[Math.floor(times.length * 0.95)] ?? 0) / 1_000_000;
      }),
    ),
  };
  await Bun.write(
    path.join(output, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  globalThis.console.warn(JSON.stringify(report));
} catch (error) {
  await Bun.write(
    path.join(output, "failure.json"),
    JSON.stringify(
      {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        visited,
        verifiedContents: [...verifiedContents],
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
    console?.close();
    try {
      await server?.stop();
    } finally {
      await brain.stop();
    }
  }
}
