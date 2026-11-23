import { actorSpellHash } from "./archived-actor-spells.mjs";
const [proofArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun compare-buff-resource-name-hash.mjs <native-proof> <output.json>",
  );
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const bytes = await Bun.file(proofArg).bytes(),
  proof = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
if (
  proof.kind !== "original-buff-resource-name-hash-controls" ||
  proof.build !== "16.21.829.8620" ||
  proof.protocol !== "20e09df23c66b85e" ||
  proof.entryRva !== 0x144b3a0 ||
  proof.casePolicy !== "ASCII-A-Z-to-a-z-only" ||
  !proof.scope.completeOriginalHashFunctionExecuted ||
  proof.scope.nativeResourceLookupEstablished !== false
)
  throw Error("Exact original ASCII buff resource hash controls required");
for (const [file, expected] of Object.entries(proof.sources))
  if (sha(await Bun.file(file).bytes()) !== expected)
    throw Error("Original hash control source changed");
for (const row of proof.cases)
  if (
    typeof row.name !== "string" ||
    /[^\x01-\x7f]/.test(row.name) ||
    actorSpellHash(row.name) !== row.hash
  )
    throw Error("Original ASCII resource name hash differs");
const result = {
  schema: 1,
  kind: "original-buff-resource-name-hash-comparison",
  nativeProofSha256: sha(bytes),
  cases: proof.cases.length,
  helperSha256: sha(
    await Bun.file(
      new URL("archived-actor-spells.mjs", import.meta.url),
    ).bytes(),
  ),
  casePolicy: proof.casePolicy,
  scope: {
    completeOriginalHashCompared: true,
    nonAsciiNamesAdmitted: false,
    nativeResourceLookupEstablished: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
