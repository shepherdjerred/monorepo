// Immutable v31 placed/active request frontier, ranked by shared UV capability.
// A parent's activation does not establish activation/rendering of its omitted emitter.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import {
  compileDirectMultUv,
  directMultUvSourceOmissions,
} from "../latest-direct-effect-mult-uv.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`MULT demand input drift ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const old = await read(
    `${cache}/research/shared-direct-playback-worker-v31-final.json`,
  ),
  manifest = await read(`${cache}/public/latest-effects/manifest.json`),
  all = old.schedules[0].coverage.rows,
  [start, end] = old.comparisonWindow,
  rows = all.filter((r) => r.time >= start && r.time <= end),
  components = [];
for (const id of [
  ...new Set(
    all
      .filter((r) => r.resourceResolved && r.definitionId)
      .map((r) => r.definitionId),
  ),
]) {
  const ref = manifest.definitions[id],
    bytes = await raw(`${cache}/public/latest-effects/${ref.file}`);
  assert.equal(await sha256(bytes), ref.sha256);
  const source = JSON.parse(new TextDecoder().decode(bytes));
  for (const [index, e] of (
    source.definition.complexEmitterDefinitionData ?? []
  ).entries()) {
    if (!e.textureMult?.uvScaleMult?.dynamics) continue;
    const matches = rows.filter((r) => r.definitionId === id),
      preroll = all.filter((r) => r.definitionId === id && r.time < start),
      primitive =
        e.primitive?.__type === "VfxPrimitiveArbitraryQuad"
          ? "arbitrary-quad"
          : e.primitive?.__type === "VfxPrimitiveCameraQuad"
            ? "camera-quad"
            : (e.primitive?.__type ?? null);
    components.push({
      id,
      index,
      sourceDefinitionSha256: ref.sha256,
      primitive,
      scaleField: e.textureMult.uvScaleMult,
      multiplyFields: Object.keys(e.textureMult),
      verifiedScaleProgram: !!compileDirectMultUv(e, primitive),
      sourceUvOmissions: directMultUvSourceOmissions(e, primitive),
      comparisonWindowRequests: matches.length,
      placed: matches.filter((r) => r.placementResolved).length,
      activeParents: matches.filter((r) => r.runtimeActivated).length,
      prerollPlaced: preroll.filter((r) => r.placementResolved).length,
      otherAuthoredFields: Object.keys(e).filter(
        (k) => !["__type", "textureMult"].includes(k),
      ),
    });
  }
}
components.sort(
  (a, b) =>
    b.activeParents - a.activeParents ||
    b.placed - a.placed ||
    b.comparisonWindowRequests - a.comparisonWindowRequests ||
    a.id.localeCompare(b.id) ||
    a.index - b.index,
);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final drift ${path}`,
  );
const output = `${cache}/research/direct-mult-scale-demand-v32.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "v31-request-frontier-dynamic-multiply-uv-demand",
      comparisonWindow: [start, end],
      inputs,
      components,
      scope: {
        immutableV31Frontier: true,
        parentCountsAreNotComponentCoverage: true,
        fullSourceCompilerAndMaterialAdmission: false,
        prerollSeparated: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    components: components.length,
    placed: components
      .filter((c) => c.placed)
      .map((c) => ({
        id: c.id,
        index: c.index,
        placed: c.placed,
        activeParents: c.activeParents,
        verifiedScaleProgram: c.verifiedScaleProgram,
      })),
  }),
);
