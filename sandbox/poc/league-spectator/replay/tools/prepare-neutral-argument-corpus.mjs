import path from "node:path";
import {
  loadNeutralArgumentProof,
  neutralArgumentRequests,
} from "./neutral-argument-corpus.mjs";
const [output, ...files] = process.argv.slice(2);
if (!output || !files.length)
  throw Error(
    "Usage: bun prepare-neutral-argument-corpus.mjs <output.json> <original-argument-proof>...",
  );
const sources = [],
  records = [];
let identity;
for (const file of files) {
  const loaded = await loadNeutralArgumentProof(file);
  if (
    loaded.proofs.length !== 1 ||
    loaded.document.kind !== "original-neutral-creation-factory-arguments"
  )
    throw Error("Independent original proof inputs required");
  const source = loaded.proofs[0];
  sources.push({
    file: path.resolve(file),
    sha256: source.sha256,
    replaySha256: source.proof.replaySha256,
    records: source.proof.records.length,
  });
  records.push(...source.proof.records);
  identity = loaded;
}
const corpus = {
  schema: 1,
  kind: "original-neutral-argument-proof-corpus",
  build: identity.build,
  protocol: identity.protocol,
  decoderImageSha256: identity.decoderImageSha256,
  sources,
  requests: neutralArgumentRequests(records),
};
const bytes = new TextEncoder().encode(JSON.stringify(corpus, null, 2));
const absolute = path.resolve(output);
await loadNeutralArgumentProof(absolute, {
  read: async (name) => (name === absolute ? bytes : Bun.file(name).bytes()),
});
if (files.some((file) => path.resolve(file) === absolute))
  throw Error("Corpus output must not overwrite an original proof");
await Bun.write(output, bytes);
console.log(
  JSON.stringify({
    output: absolute,
    proofs: sources.length,
    records: records.length,
    requests: corpus.requests.length,
    nativeSpectatorAdmitted: false,
  }),
);
