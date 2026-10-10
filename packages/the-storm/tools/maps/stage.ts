import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  MapContent,
  MapScenario,
  sourceScenario,
  validateScenario,
} from "#learning/maps/scenario.ts";
import { root } from "./paper.ts";
import { freezeInputs } from "./inputs.ts";

const args = parseArgs({
  strict: true,
  options: {
    bake: { type: "string" },
    details: { type: "string" },
    output: { type: "string" },
    extra: { type: "string", multiple: true },
    quarantine: { type: "string", multiple: true },
  },
});
const required = (value: unknown) =>
  path.resolve(z.string().min(1).parse(value));
const bake = required(args.values.bake);
const details = required(args.values.details);
const output = required(args.values.output);
const identity = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const quarantine = new Set(
  z.array(identity).parse(args.values.quarantine ?? []),
);
const results = z
  .array(
    z.object({
      id: identity,
      status: z.string(),
      reason: z.string().optional(),
    }),
  )
  .parse(await Bun.file(path.join(bake, "results.json")).json());
const exports = z
  .array(
    z.object({
      id: identity,
      status: z.literal("exported-awaiting-runtime-acceptance"),
    }),
  )
  .parse(await Bun.file(path.join(details, "results.json")).json());
if (
  new Set(results.map((entry) => entry.id)).size !== results.length ||
  new Set(exports.map((entry) => entry.id)).size !== exports.length
)
  throw new Error("Staging inputs repeat a map identity");
const extras = new Map<string, string>();
for (const extra of args.values.extra ?? []) {
  const folder = path.resolve(extra);
  const map = MapContent.parse(
    Bun.YAML.parse(await Bun.file(path.join(folder, "map.yml")).text()),
  );
  if (extras.has(map.id)) throw new Error("Staging extras repeat a map");
  extras.set(map.id, folder);
}
for (const id of [...quarantine, ...extras.keys()])
  if (!results.some((entry) => entry.id === id))
    throw new Error(`Unknown staging identity: ${id}`);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { mode: 0o700 });
const inputs = await freezeInputs(root, output);
const maps = path.join(output, "maps");
await mkdir(maps);
const scenarios = [];
const staged = [];
const excluded = [];
async function verify(folder: string, id: string) {
  for (const action of ["verify", "verify-details"]) {
    const child = Bun.spawn(
      [
        "mise",
        "exec",
        "--",
        path.join(inputs.mapTool, "bin/rwfmap"),
        action,
        folder,
      ],
      {
        cwd: root,
        stdout: Bun.file(path.join(output, `${id}-${action}.log`)),
        stderr: "pipe",
      },
    );
    const stderr = await new Response(child.stderr).text();
    await Bun.write(path.join(output, `${id}-${action}.stderr`), stderr);
    if ((await child.exited) !== 0)
      throw new Error(`Staging validation failed for ${id}: ${action}`);
  }
}
for (const entry of results) {
  if (quarantine.has(entry.id)) {
    if (entry.status !== "failed" || extras.has(entry.id))
      throw new Error(
        "Only unrepaired, failed offline maps may be quarantined",
      );
    excluded.push(entry);
    continue;
  }
  const extra = extras.get(entry.id);
  if (
    extra === undefined &&
    !entry.status.startsWith("offline-verified-awaiting-")
  )
    throw new Error(`Unresolved map cannot be staged: ${entry.id}`);
  if (!exports.some((exported) => exported.id === entry.id))
    throw new Error(`Missing isolated payload export: ${entry.id}`);
  const source = extra ?? path.join(bake, "maps", entry.id);
  const target = path.join(maps, entry.id);
  await mkdir(target);
  for (const file of [
    "map.yml",
    "blocks.schem",
    "nav.rwfnav",
    "nav.summary.json",
    "source.json",
  ])
    await cp(path.join(source, file), path.join(target, file));
  const payloadSource = path.join(details, entry.id);
  const provenance = z
    .object({
      id: identity,
      blocksSha256: z.string(),
      detailsSha256: z.string(),
    })
    .parse(await Bun.file(path.join(payloadSource, "provenance.json")).json());
  const map = MapContent.parse(
    Bun.YAML.parse(await Bun.file(path.join(target, "map.yml")).text()),
  );
  const bytes = await Bun.file(
    path.join(payloadSource, "details.json"),
  ).arrayBuffer();
  if (
    map.id !== entry.id ||
    provenance.id !== map.id ||
    provenance.blocksSha256 !== map.blocksSha256 ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !==
      provenance.detailsSha256
  )
    throw new Error(`Payload provenance differs from terrain: ${entry.id}`);
  await Bun.write(path.join(target, "details.json"), bytes);
  await cp(
    path.join(payloadSource, "provenance.json"),
    path.join(target, "details.provenance.json"),
  );
  const scenario = sourceScenario(map);
  validateScenario(scenario, map);
  await Bun.write(
    path.join(target, "scenario.json"),
    JSON.stringify(scenario, null, 2) + "\n",
  );
  await verify(target, map.id);
  scenarios.push(scenario);
  staged.push({
    id: map.id,
    teams: map.teams.length,
    blocksSha256: map.blocksSha256,
  });
  console.warn(`Staged for native proof: ${map.id}`);
}
const training = path.join(inputs.content, "rwf/maps/training-yard");
await cp(training, path.join(maps, "training-yard"), { recursive: true });
await verify(path.join(maps, "training-yard"), "training-yard");
const trainingScenario = MapScenario.parse(
  await Bun.file(path.join(training, "scenario.json")).json(),
);
scenarios.push(trainingScenario);
await inputs.check();
await Bun.write(
  path.join(output, "scenarios.json"),
  JSON.stringify({ schema: 1, kind: "rwf-map-scenarios", scenarios }, null, 2) +
    "\n",
);
await Bun.write(
  path.join(output, "staged.json"),
  JSON.stringify(
    {
      schema: 1,
      status: "offline-verified-awaiting-native-acceptance",
      staged,
      quarantined: excluded,
    },
    null,
    2,
  ) + "\n",
);
