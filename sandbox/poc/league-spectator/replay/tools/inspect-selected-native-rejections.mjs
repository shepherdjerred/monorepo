// Rehashing a trusted content root cannot approve another native program.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: bun inspect-selected-native-rejections.mjs <cache>");
const cache = resolve(cacheArg),
  inputs = {},
  original = new Map();
const encode = (value) => new TextEncoder().encode(JSON.stringify(value)),
  decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
async function load(path) {
  if (!original.has(path))
    original.set(path, await raw(`${cache}/public/${path}`));
  return original.get(path).slice();
}
await captureDirectSourceInputs([import.meta.path], raw);
const selected = await loadLatestStaticCatalogSelection({ load }),
  image = await selected.read("decoder-16.21-macos/image.bin"),
  initial = selected.serializeForWorker(),
  baseCatalog = decode(initial.catalogBytes),
  contextPath = baseCatalog.roles.effectContexts,
  proofPath = baseCatalog.roles.effectContextsProof,
  baseContext = decode(await selected.readRole("effectContexts")),
  baseProof = decode(await selected.readRole("effectContextsProof"));
const cases = [
  [
    "unapproved-preparer",
    ({ context }) => {
      context.preparerSha256 = "0".repeat(64);
    },
    /program approval/,
  ],
  [
    "unapproved-native-source",
    ({ proof }) => {
      proof.sources[Object.keys(proof.sources)[0]] = "0".repeat(64);
    },
    /producer sources/,
  ],
  [
    "altered-identity-program",
    ({ context }) => {
      context.identity.multiplier++;
    },
    /program approval/,
  ],
  [
    "upgraded-live-acceptance-scope",
    ({ proof }) => {
      proof.scope.matchCreationExecuted = true;
    },
    /program approval/,
  ],
  [
    "rehashed-native-block",
    ({ context, proof }) => {
      proof.originalBlocks[0].sha256 = "0".repeat(64);
      context.sourceBlocks = structuredClone(proof.originalBlocks);
    },
    /instruction block/,
  ],
  [
    "foreign-observed-row",
    ({ proof }) => {
      proof.contexts[0].skinId++;
    },
    /observation rows/,
  ],
  [
    "incomplete-boundary-controls",
    ({ proof }) => {
      proof.boundaries.pop();
    },
    /observation inventory/,
  ],
  [
    "missing-native-proof-role",
    ({ catalog }) => {
      delete catalog.roles.effectContextsProof;
    },
    /Selected static role required/,
  ],
  [
    "altered-native-image",
    ({ state }) => {
      state.image = image.slice();
      state.image[0] ^= 1;
    },
    /^Pinned effect context package\/image required$/,
  ],
];
const controls = [];
for (const [label, mutate, expected] of cases) {
  const state = {
    context: structuredClone(baseContext),
    proof: structuredClone(baseProof),
    catalog: structuredClone(baseCatalog),
    image,
  };
  mutate({ ...state, state });
  const overrides = new Map(),
    proofBytes = encode(state.proof);
  state.context.observationSha256 = await sha256(proofBytes);
  for (const [path, bytes] of [
    [proofPath, proofBytes],
    [contextPath, encode(state.context)],
  ]) {
    overrides.set(path, bytes);
    state.catalog.files[path] = {
      sha256: await sha256(bytes),
      bytes: bytes.length,
    };
  }
  const catalogBytes = encode(state.catalog),
    bootstrap = decode(initial.bootstrapBytes);
  bootstrap.catalog.sha256 = await sha256(catalogBytes);
  overrides.set(bootstrap.catalog.path, catalogBytes);
  overrides.set("latest-static-catalog/bootstrap.json", encode(bootstrap));
  // Explicit diagnostic root replacement, never a runtime fallback.
  const candidate = await loadLatestStaticCatalogSelection({
    load: async (path) =>
      overrides.has(path) ? overrides.get(path).slice() : load(path),
  });
  let error = null;
  try {
    await createLatestEffectContexts({
      profile: candidate.profile(),
      image: state.image,
      packageBytes: await candidate.readRole("effectContexts"),
      effectsManifestBytes: await candidate.readRole("effects"),
      staticCatalog: candidate,
    });
  } catch (caught) {
    error = { name: caught.name, message: caught.message };
  }
  if (!error || !expected.test(error.message))
    throw Error(
      `Native rejection control ${label} failed: ${JSON.stringify(error)}`,
    );
  controls.push({
    label,
    contentClosureAccepted: true,
    nativeApprovalRejected: true,
    error,
  });
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error("Native rejection input changed: " + path);
const output = `${cache}/research/selected-native-approval-rejections.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "selected-content-cannot-reapprove-native-program-controls",
      inputs,
      controls,
      scope: {
        trustedRootMutationsAreDiagnosticOnly: true,
        nativeInstructionsExecuted: false,
        renderedCoverage: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    controls: controls.length,
    rejections: controls.length,
  }),
);
