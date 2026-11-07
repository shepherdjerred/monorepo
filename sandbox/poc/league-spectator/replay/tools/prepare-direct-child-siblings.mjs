import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  canonicalChildSource,
  DIRECT_CHILD_SIBLING_POLICY,
} from "../latest-direct-child-siblings.mjs";

const cache = path.resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function raw(file, expected = null) {
  const absolute = path.resolve(file),
    bytes = await readFile(absolute),
    digest = sha(bytes);
  if (expected !== null && digest !== expected)
    throw new Error(`Child sibling preparation input drift: ${absolute}`);
  inputs[absolute] = digest;
  return bytes;
}
async function json(file, expected = null) {
  return JSON.parse(await raw(file, expected));
}
const proofPath = path.join(
    cache,
    "research/direct-child-sibling-comparison.json",
  ),
  proof = await json(proofPath);
if (
  proof.kind !== "native-paired-child-free-sibling-comparison" ||
  proof.passed !== true ||
  proof.results.length !== 2 ||
  proof.results.some(
    (result) =>
      !result.matched ||
      result.counts.frames !== 61 ||
      result.counts.positiveGeometryFrames < 1,
  )
)
  throw new Error("Complete positive original sibling comparison required");
for (const [file, digest] of Object.entries(proof.inputs))
  await raw(file, digest);
const manifest = await json(
    path.join(cache, "public/latest-effects/manifest.json"),
  ),
  capabilities = [];
for (const result of proof.results) {
  const ref = manifest.definitions[result.effectId];
  const source = await json(
    path.join(cache, "public/latest-effects", ref.file),
    ref.sha256,
  );
  for (const index of result.childIndices) {
    const emitter = source.definition.complexEmitterDefinitionData[index];
    const declaration = emitter.childParticleSetDefinition,
      identifier = declaration.childrenIdentifiers[0];
    if (
      Object.keys(declaration).length !== 2 ||
      declaration.__type !== "VfxChildParticleSetDefinitionData" ||
      declaration.childrenIdentifiers.length !== 1 ||
      Object.keys(identifier).length !== 2 ||
      identifier.__type !== "VfxChildIdentifier" ||
      !/^\{[0-9a-f]{8}\}$/i.test(identifier.effectKey)
    )
      throw new Error("Only observed nonzero key-only child declarations");
    const childSourceSha256 = sha(Buffer.from(canonicalChildSource(emitter)));
    if (
      capabilities.some(
        (entry) => entry.childSourceSha256 === childSourceSha256,
      )
    )
      throw new Error("Duplicate capability source");
    capabilities.push({
      childSourceSha256,
      source: emitter,
      effectKey: Number.parseInt(identifier.effectKey.slice(1, -1), 16),
      evidence: {
        pairedComparisonSha256: inputs[path.resolve(proofPath)],
        nativeFrames: 61,
        siblingGeometryFrames: result.counts.positiveGeometryFrames,
        globalRngFrames: result.counts.globalRngFrames,
      },
    });
  }
}
capabilities.sort((a, b) =>
  a.childSourceSha256.localeCompare(b.childSourceSha256),
);
const directory = path.join(cache, "public/latest-child-sibling-capabilities");
await mkdir(directory, { recursive: true });
const packageData = {
  schema: 1,
  kind: "original-child-source-sibling-capabilities",
  policy: DIRECT_CHILD_SIBLING_POLICY,
  build: proof.build,
  protocol: proof.protocol,
  capabilities,
  scope: {
    sourceStructureCoverageBound: true,
    fullChildFamilySupport: false,
    childSchedulerActivationRecovered: false,
    nativeParentCompletionRecovered: false,
    nativeReplayAcceptance: null,
  },
};
const bytes = Buffer.from(JSON.stringify(packageData) + "\n"),
  output = path.join(directory, "package.json");
await writeFile(output, bytes);
const contract = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../latest-direct-child-siblings-contract.mjs",
);
await writeFile(
  contract,
  `// Exact static original child-source capability package.\nexport const DIRECT_CHILD_SIBLING_PACKAGE_SHA = "${sha(bytes)}";\n`,
);
for (const [file, digest] of Object.entries(inputs))
  if (sha(await readFile(file)) !== digest)
    throw new Error(`Final child preparation input drift: ${file}`);
await writeFile(
  path.join(cache, "research/direct-child-sibling-preparation.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "prepared-child-source-sibling-capabilities",
      package: output,
      packageSha256: sha(bytes),
      capabilities: capabilities.length,
      inputs,
      scope: packageData.scope,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    output,
    packageSha256: sha(bytes),
    capabilities: capabilities.length,
    inputs: Object.keys(inputs).length,
  }),
);
