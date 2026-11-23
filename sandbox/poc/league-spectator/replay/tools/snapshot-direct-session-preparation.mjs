// Retain the exact pre-extraction preparation body for source-bound differential
// checks. This generated artifact is never imported by the spectator.
import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error("Fresh preparation baseline output directory required");
const output = resolve(outputArg),
  source = resolve(import.meta.dir, "../latest-direct-effect-session.mjs"),
  inputs = {};
await captureDirectSourceInputs([source], async (file) => {
  const bytes = await Bun.file(file).bytes();
  inputs[file] = sha(bytes);
  return bytes;
});
const bytes = await Bun.file(source).bytes(),
  text = new TextDecoder().decode(bytes),
  marker = "  let navigation = null;",
  boundary = text.indexOf(marker);
if (
  boundary < 0 ||
  text.indexOf(marker, boundary + 1) !== -1 ||
  !text.includes("export async function createLatestDirectEffectSession({")
)
  throw Error("Exact original session preparation boundary required");
const prefix = text
  .slice(0, boundary)
  .replace(
    "export async function createLatestDirectEffectSession(",
    "export async function prepareOriginalDirectSessionInputs(",
  );
const generated =
  prefix +
  "  return {sessionStarted,trace,load,prepared,events,presentationWorld,viewerPoseAssets,worldInputs,heightValues,placementPolicy,initialResources,poseInitialization,staticCatalogInitialization,targetedSourcePreparationMetrics,packageElapsedMs};\n}\n";
await mkdir(output, { recursive: true });
if (await Bun.file(join(output, "manifest.json")).exists())
  throw Error("Fresh source snapshot namespace required");
await Bun.write(join(output, "original-session.mjs"), bytes);
await Bun.write(join(output, "preparation-baseline.mjs"), generated);
await Bun.write(
  join(output, "manifest.json"),
  JSON.stringify({
    schema: 1,
    kind: "exact-pre-extraction-session-preparation",
    source,
    sourceSha256: sha(bytes),
    baselineSha256: sha(new TextEncoder().encode(generated)),
    resolveDirectory: resolve(import.meta.dir, ".."),
    inputs,
  }),
);
console.log(
  JSON.stringify({
    output,
    sourceSha256: sha(bytes),
    inputs: Object.keys(inputs).length,
  }),
);
