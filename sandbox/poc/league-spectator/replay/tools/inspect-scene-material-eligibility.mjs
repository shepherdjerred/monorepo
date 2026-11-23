import path from "node:path";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [rootArg, reportArg] = process.argv.slice(2);
if (!reportArg)
  throw Error(
    "Usage: bun inspect-scene-material-eligibility.mjs <closed-public-root> <output.json>",
  );
const root = path.resolve(rootArg),
  inputs = {};
async function raw(file) {
  const bytes = await Bun.file(file).bytes();
  inputs[path.resolve(file)] = sha(bytes);
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const load = (file) => raw(path.join(root, file)),
  selection = await loadLatestStaticCatalogSelection({ load }),
  manifestBytes = await selection.readRole("effects"),
  quad = JSON.parse(
    new TextDecoder().decode(await selection.readRole("quadGpu")),
  ),
  ids = [...new Set(quad.emitters.map((row) => row.effectId))],
  compiled = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: ids,
    staticCatalog: selection,
  }),
  rows = [],
  reasons = {};
for (const material of quad.emitters) {
  const definition = compiled.definitions.get(material.effectId),
    unsupported = definition.unsupported.filter(
        (row) => row.index === material.emitterIndex,
    ),
    admitted = definition.emitters.filter(
        (row) => row.index === material.emitterIndex,
    );
  rows.push({
    effectId: material.effectId,
    emitterIndex: material.emitterIndex,
    admitted: admitted.length,
    unsupported,
  });
  for (const row of unsupported)
    for (const reason of row.reasons ?? [row.reason ?? "unknown"]) {
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
}
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Scene material eligibility source changed");
await Bun.write(
  reportArg,
  JSON.stringify({
    schema: 1,
    kind: "actual-scene-material-component-eligibility",
    prepared: quad.emitters.length,
    rows,
    reasons,
    inputs,
  }),
);
console.log(
  JSON.stringify({
    output: reportArg,
    prepared: quad.emitters.length,
    admitted: rows.reduce((sum, row) => sum + row.admitted, 0),
    reasons,
    sample: rows.slice(0, 2),
  }),
);
