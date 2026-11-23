import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadNeutralArgumentProof } from "./neutral-argument-corpus.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
function fixture() {
  const codePath = path.resolve("fixture-source.py"),
    code = encode("original helper");
  const files = new Map([[codePath, code]]),
    proofs = [];
  for (let i = 0; i < 2; i++) {
    const file = path.resolve(`fixture-proof-${i}.json`);
    const proof = {
      schema: 1,
      kind: "original-neutral-creation-factory-arguments",
      build: "16.21.829.8620",
      protocol: "20e09df23c66b85e",
      decoderImageSha256:
        "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
      replaySha256: String(i + 1).repeat(64),
      boundary: null,
      scope: { originalArgumentPrefixExecuted: true },
      sources: { [codePath]: sha(code) },
      records: [
        {
          character: i ? "SRU_Crab" : "Sru_Crab",
          skinId: 0,
          transportSequence: 99,
        },
        {
          character: i ? "Hextech" : "Water",
          skinId: 0,
          transportSequence: 100,
        },
      ],
    };
    const bytes = encode(proof);
    files.set(file, bytes);
    proofs.push({
      file,
      sha256: sha(bytes),
      replaySha256: proof.replaySha256,
      records: 2,
    });
  }
  const file = path.resolve("fixture-corpus.json"),
    corpus = {
      schema: 1,
      kind: "original-neutral-argument-proof-corpus",
      build: "16.21.829.8620",
      protocol: "20e09df23c66b85e",
      decoderImageSha256:
        "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
      sources: proofs,
      requests: [
        { character: "hextech", skinId: 0 },
        { character: "sru_crab", skinId: 0 },
        { character: "water", skinId: 0 },
      ],
    };
  const read = async (name) => {
    if (name === file) return encode(corpus);
    if (!files.has(name)) throw Error("Missing test file");
    return files.get(name);
  };
  return { file, corpus, files, read, codePath };
}
test("corpus derives case-insensitive static requests while preserving each original record and replay provenance", async () => {
  const f = fixture(),
    loaded = await loadNeutralArgumentProof(f.file, f);
  expect(loaded.requests).toEqual(f.corpus.requests);
  expect(loaded.records.map((row) => row.character)).toEqual([
    "Sru_Crab",
    "Water",
    "SRU_Crab",
    "Hextech",
  ]);
  expect(loaded.proofs.map((source) => source.proof.replaySha256)).toEqual([
    "1".repeat(64),
    "2".repeat(64),
  ]);
  expect(loaded.records.map((row) => row.transportSequence)).toEqual([
    99, 100, 99, 100,
  ]);
  expect(
    (await loadNeutralArgumentProof(f.corpus.sources[0].file, f)).requests,
  ).toEqual([
    { character: "sru_crab", skinId: 0 },
    { character: "water", skinId: 0 },
  ]);
});
test("corpus rejects omitted requests, altered sources, duplicate matches, future identity and changed original producer", async () => {
  for (const mutate of [
    (f) => f.corpus.requests.pop(),
    (f) => f.corpus.sources[0].records++,
    (f) => (f.corpus.sources[1] = { ...f.corpus.sources[0] }),
    (f) => (f.corpus.protocol = "future"),
    (f) => f.files.set(f.codePath, encode("changed helper")),
    (f) => (f.corpus.extra = true),
  ]) {
    const f = fixture();
    mutate(f);
    await expect(loadNeutralArgumentProof(f.file, f)).rejects.toThrow();
  }
});
