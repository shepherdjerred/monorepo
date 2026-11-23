// Resource requests come from executed original callback prefixes. Catalog name
// candidates preserve collisions and do not establish native registry ownership.
import path from "node:path";
import { actorSpellHash } from "./archived-actor-spells.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [proofArg, sceneArg, builtinArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 6)
  throw Error(
    "Usage: bun inspect-buff-resource-requests.mjs <native-rpc-prefix-proof> <scene-root> <builtin-resource-context-program> <output.json>",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  inputs = {};
async function raw(file) {
  const absolute = path.resolve(file),
    bytes = await Bun.file(absolute).bytes(),
    digest = sha(bytes);
  if (inputs[absolute] && inputs[absolute] !== digest)
    throw Error("Buff resource source changed");
  inputs[absolute] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const proof = decode(await raw(proofArg)),
  builtinBytes = await raw(builtinArg),
  builtin = decode(builtinBytes),
  scene = decode(await raw(path.join(sceneArg, "manifest.json")));
if (
  proof.kind !== "original-buff-rpc-argument-prefix-controls" ||
  proof.boundary !== null ||
  proof.build !== "16.21.829.8620" ||
  proof.protocol !== "20e09df23c66b85e" ||
  !proof.scope.originalCallbackArgumentPrefixesExecuted ||
  proof.scope.originalSemanticCallsExecuted !== false ||
  sha(builtinBytes) !==
    "3fab8bb246b194bce340574b555b0eb3f271ff288e2cdd00c8ef6c2ae545cbb5" ||
  scene.build !== proof.build ||
  scene.protocol !== proof.protocol
)
  throw Error(
    "Complete exact original RPC prefixes and selected scene/builtin identities required",
  );
for (const [file, expected] of Object.entries(proof.sources))
  if (sha(await raw(file)) !== expected)
    throw Error("Original buff RPC prefix source differs");
const inventory = new Map(scene.files.map((row) => [row.path, row]));
async function resource(file) {
  const entry = inventory.get(file);
  if (
    !entry ||
    file.split("/").some((part) => !part || part === ".." || part === ".")
  )
    throw Error("Declared spell catalog file required");
  const bytes = await raw(path.join(sceneArg, file));
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error("Selected spell catalog source differs");
  return decode(bytes);
}
const world = await resource(scene.world),
  known = new Map();
for (const [actor, asset] of Object.entries({
  ...scene.champions,
  ...world.assets,
})) {
  const catalog = await resource(asset.spellCatalog);
  for (const [hash, spell] of Object.entries(catalog.spells)) {
    if (
      typeof spell.name !== "string" ||
      actorSpellHash(spell.name) !== Number(hash)
    )
      throw Error("Original spell name hash differs");
    if (!known.has(Number(hash))) known.set(Number(hash), []);
    known
      .get(Number(hash))
      .push({
        actor,
        name: spell.name,
        object: spell.path,
        catalog: asset.spellCatalog,
        catalogSha256: inventory.get(asset.spellCatalog).sha256,
      });
  }
}
const requests = new Map();
for (const row of proof.records) {
  if (row.opcode !== 1160) continue;
  if (
    row.semanticTargetRva !== 0x842670 ||
    !/^[a-f0-9]{80}$/.test(row.originalBuffDescriptorHex)
  )
    throw Error("Original bounded buff descriptor prefix required");
  const bytes = Uint8Array.from(
      row.originalBuffDescriptorHex.match(/../g),
      (value) => parseInt(value, 16),
    ),
    view = new DataView(bytes.buffer);
  const resourceNameHash = view.getUint32(4, true),
    contextId = view.getUint32(8, true);
  const key = `${contextId}/${resourceNameHash}`;
  if (!requests.has(key))
    requests.set(key, {
      contextId,
      resourceNameHash,
      contextIdentity:
        contextId === builtin.shared.identity
          ? "original-shared-identity"
          : "unresolved-recorded-context",
      occurrences: 0,
      firstCursor: {
        time: row.time,
        transportSequence: row.transportSequence,
        stream: row.stream,
      },
      lastCursor: null,
      knownSpellCatalogNames: known.get(resourceNameHash) ?? [],
    });
  const request = requests.get(key);
  request.occurrences++;
  request.lastCursor = {
    time: row.time,
    transportSequence: row.transportSequence,
    stream: row.stream,
  };
}
for (const [file, expected] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== expected)
    throw Error("Buff resource inventory source changed: " + file);
const result = {
  schema: 1,
  kind: "recorded-buff-resource-requests",
  build: proof.build,
  protocol: proof.protocol,
  decoderImageSha256: proof.decoderImageSha256,
  nativePrefixProofSha256: inputs[path.resolve(proofArg)],
  sceneManifestSha256: inputs[path.resolve(sceneArg, "manifest.json")],
  builtinResourceContextsSha256: sha(builtinBytes),
  replaySha256: proof.replaySha256,
  requests: [...requests.values()],
  inputs,
  scope: {
    originalDescriptorArgumentsOnly: true,
    completeNativeRegistryReconstructed: false,
    hashCollisionCandidatesPreserved: true,
    sourceResourceResolutionEstablished: false,
    nativeBuffMembershipEstablished: false,
    nativeGraphStateAdmitted: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: path.resolve(outputArg),
    requests: requests.size,
    shared: [...requests.values()].filter(
      (row) => row.contextId === builtin.shared.identity,
    ).length,
    namedCandidates: [...requests.values()].filter(
      (row) => row.knownSpellCatalogNames.length,
    ).length,
  }),
);
