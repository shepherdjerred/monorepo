// A corpus references independent original observations. It is not a new native
// observation or a transport ordering between matches.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const schema = JSON.parse(
  await readFile(
    new URL("neutral-argument-corpus.schema.json", import.meta.url),
    "utf8",
  ),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sameKeys = (value, keys) =>
  value &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const identityKeys = ["build", "protocol", "decoderImageSha256"];
function identity(value) {
  if (!identityKeys.every((key) => value[key] === schema.properties[key].const))
    throw Error("Exact original neutral argument build required");
}
export function neutralArgumentRequests(records) {
  if (
    !Array.isArray(records) ||
    !records.length ||
    records.length > schema["x-maximumTotalRecords"]
  )
    throw Error("Bounded original neutral arguments required");
  const requests = new Map();
  for (const row of records) {
    if (
      !/^[a-z0-9_]{1,128}$/i.test(row.character) ||
      !Number.isInteger(row.skinId) ||
      row.skinId < 0 ||
      row.skinId > 0xffffffff
    )
      throw Error("Original neutral character/skin identity required");
    const character = row.character.toLowerCase();
    requests.set(`${character}/${row.skinId}`, {
      character,
      skinId: row.skinId,
    });
  }
  if (requests.size > schema.properties.requests.maxItems)
    throw Error("Bounded neutral request set required");
  return [...requests.values()].sort(
    (a, b) =>
      (a.character < b.character ? -1 : a.character > b.character ? 1 : 0) ||
      a.skinId - b.skinId,
  );
}
export async function loadNeutralArgumentProof(file, { read = readFile } = {}) {
  const inputs = {};
  async function document(name) {
    const absolute = path.resolve(name),
      bytes = await read(absolute);
    if (bytes.length > schema["x-maximumProofBytes"])
      throw Error("Bounded neutral proof bytes required");
    inputs[absolute] = sha(bytes);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  async function original(proof) {
    identity(proof);
    if (
      proof.schema !== 1 ||
      proof.kind !== "original-neutral-creation-factory-arguments" ||
      proof.boundary !== null ||
      proof.scope?.originalArgumentPrefixExecuted !== true ||
      !digest(proof.replaySha256) ||
      !proof.sources ||
      !Object.keys(proof.sources).length ||
      Object.keys(proof.sources).length > 512
    )
      throw Error(
        "Complete independent original neutral argument proof required",
      );
    neutralArgumentRequests(proof.records);
    for (const [name, expected] of Object.entries(proof.sources)) {
      if (!digest(expected) || sha(await read(name)) !== expected)
        throw Error("Original neutral argument producer changed: " + name);
    }
    return proof;
  }
  const value = await document(file);
  const proofs = [];
  if (value.kind === "original-neutral-creation-factory-arguments") {
    proofs.push({
      file: path.resolve(file),
      sha256: inputs[path.resolve(file)],
      proof: await original(value),
    });
  } else {
    identity(value);
    if (
      !sameKeys(value, schema.required) ||
      value.schema !== schema.properties.schema.const ||
      value.kind !== schema.properties.kind.const ||
      !Array.isArray(value.sources) ||
      !value.sources.length ||
      value.sources.length > schema.properties.sources.maxItems
    )
      throw Error("Explicit bounded neutral argument corpus required");
    const seen = new Set(),
      replays = new Set();
    for (const source of value.sources) {
      if (
        !sameKeys(source, schema.properties.sources.items.required) ||
        typeof source.file !== "string" ||
        !source.file.length ||
        source.file.length > 2048 ||
        !digest(source.sha256) ||
        !digest(source.replaySha256) ||
        !Number.isInteger(source.records) ||
        source.records < 1 ||
        source.records > 10000 ||
        seen.has(source.sha256) ||
        replays.has(source.replaySha256)
      )
        throw Error("Unique complete neutral corpus source required");
      seen.add(source.sha256);
      replays.add(source.replaySha256);
      const proof = await original(await document(source.file));
      if (
        inputs[path.resolve(source.file)] !== source.sha256 ||
        proof.replaySha256 !== source.replaySha256 ||
        proof.records.length !== source.records
      )
        throw Error("Neutral corpus source identity differs");
      proofs.push({
        file: path.resolve(source.file),
        sha256: source.sha256,
        proof,
      });
    }
  }
  const records = proofs.flatMap((source) => source.proof.records);
  const requests = neutralArgumentRequests(records);
  if (
    value.kind === schema.properties.kind.const &&
    JSON.stringify(value.requests) !== JSON.stringify(requests)
  )
    throw Error(
      "Neutral corpus request set differs from complete original sources",
    );
  return {
    document: value,
    proofs,
    records,
    requests,
    inputs,
    ...Object.fromEntries(identityKeys.map((key) => [key, value[key]])),
  };
}
