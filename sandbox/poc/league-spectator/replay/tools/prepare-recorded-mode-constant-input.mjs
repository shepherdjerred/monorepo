// Bind an original recorded Map11 mode selection to its authored mode/constants.
// Remaining mode object links stay explicitly outside this cold-owner control.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";

const [binArg, evidenceArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 5)
  throw Error(
    "Usage: bun prepare-recorded-mode-constant-input.mjs <map-definition.bin> <original-world-inspection.json> <output.json>",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const path = resolve(file),
    bytes = await Bun.file(path).bytes(),
    digest = sha(bytes);
  assert(
    !inputs[path] || inputs[path] === digest,
    "Recorded mode input changed: " + path,
  );
  inputs[path] = digest;
  return bytes;
}
const evidenceBytes = await raw(evidenceArg),
  evidence = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(evidenceBytes),
  );
assert.equal(evidence.kind, "original-map11-world-inspection");
assert.equal(evidence.build, "16.21.829.8620");
assert.equal(evidence.protocol, "20e09df23c66b85e");
assert.equal(evidence.startup.configuredMapId, 11);
assert.equal(evidence.startup.source.opcode, 728);
assert.equal(
  evidence.startup.packageSha256,
  "b97e3531eef2f7e377babb320fbd89f865afe61376f0ee6510f68ccd50c3fde3",
);
for (const [file, expected] of Object.entries(evidence.inputs))
  assert.equal(sha(await raw(file)), expected);
const bytes = await raw(binArg),
  tree = readExactMapBin(bytes, evidence.build, { captureFieldSpans: true });
assert.equal(
  sha(bytes),
  "97ce42d783534698c4ab852a6fccc1dccaeb795306bad9121ada2cacd958155e",
);
const modes = tree.objects.filter(
  (row) =>
    row.classHash === "89ce9636" &&
    row.fields["bc476670"]?.type === "Hash" &&
    row.fields["bc476670"].value === evidence.startup.modeHash,
);
assert.equal(
  modes.length,
  1,
  "Unique source mode matching the original recorded startup required",
);
const mode = modes[0],
  link = mode.fields["34c9a66e"];
assert.equal(link.type, "ObjectLink");
const constants = tree.objects.filter(
  (row) => Number.parseInt(row.pathHash, 16) === link.value,
);
assert.equal(
  constants.length,
  1,
  "Exact original local constants owner required",
);
assert.equal(constants[0].classHash, "0c07acc5");
function project(row) {
  return {
    identity: Number.parseInt(row.pathHash, 16),
    typeHash: Number.parseInt(row.classHash, 16),
    fields: row.fieldSpans.map((span) => ({
      ...span,
      sha256: sha(bytes.subarray(span.offset, span.offset + span.bytes)),
    })),
  };
}
for (const [file, digest] of Object.entries(inputs))
  assert.equal(sha(await Bun.file(file).bytes()), digest);
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-recorded-map11-mode-constant-input",
      build: evidence.build,
      protocol: evidence.protocol,
      replaySha256: evidence.replaySha256,
      startup: evidence.startup,
      startupEvidenceSha256: sha(evidenceBytes),
      source: {
        file: resolve(binArg),
        bytes: bytes.length,
        sha256: sha(bytes),
      },
      mode: project(mode),
      constants: project(constants[0]),
      inputs,
      sources: {
        preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
        readerSha256: sha(
          await Bun.file(new URL("exact-map-bin.mjs", import.meta.url)).bytes(),
        ),
      },
      scope: {
        originalRecordedModeSelected: true,
        fullModeReferenceClosureAdmitted: false,
        liveWorldBindingsAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: resolve(outputArg),
    modeHash: evidence.startup.modeHash,
    modeIdentity: mode.pathHash,
    constantsIdentity: constants[0].pathHash,
  }),
);
