import { resolve } from "node:path";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    digest = await sha256(data);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`UV admission input drift: ${path}`);
  inputs[path] = digest;
  return data;
}
const load = (path) => raw(`${cache}/public/${path}`);
const baseline = JSON.parse(
  new TextDecoder().decode(await raw(`${cache}/research/direct-effects.json`)),
);
if (
  !baseline.definitions.length ||
  baseline.definitions.some((d) => d.programVersion !== 22)
)
  throw Error("Preserved v22 admission baseline required");
const manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
await captureDirectSourceInputs([import.meta.path], raw);
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: Object.keys(manifest.definitions),
});
const rows = [...prepared.definitions.values()].map((d) => ({
  id: d.id,
  blockers: d.blockers,
  components: d.emitters.map((e) => ({
    index: e.index,
    spriteProgram: e.spriteProgram,
    paletteProgram: e.paletteProgram,
  })),
  unsupported: d.unsupported,
}));
const byId = new Map(rows.map((d) => [d.id, d]));
const added = baseline.definitions.flatMap((before) =>
  byId
    .get(before.id)
    .components.filter((c) => !before.supported.includes(c.index))
    .map((component) => ({ effectId: before.id, ...component })),
);
const removed = baseline.definitions.flatMap((before) =>
  before.supported
    .filter((i) => !byId.get(before.id).components.some((c) => c.index === i))
    .map((index) => ({ effectId: before.id, index })),
);
if (removed.length)
  throw Error("UV increment removed previously admitted components");
const result = {
  schema: 1,
  kind: "direct-uv-static-admission-delta",
  inputs,
  counts: {
    definitions: rows.length,
    withComponents: rows.filter((d) => d.components.length).length,
    components: rows.reduce((n, d) => n + d.components.length, 0),
    recordedDefinitions: baseline.definitions.length,
    addedRecordedComponents: added.length,
  },
  added,
  removed,
  definitions: rows,
  scope: {
    staticAdmissionOnly: true,
    runtimeActivated: false,
    actualMatchRendered: false,
    baselineInputSnapshotMayBeHistorical: true,
  },
};
for (const path of Object.keys(inputs)) await raw(path);
const output = `${cache}/research/direct-uv-admission-delta.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, counts: result.counts, added }));
