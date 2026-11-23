import { createHash } from "node:crypto";

// The original graph cache stores each row's ordinal on every insert, including
// an existing key. Its final value is therefore the last ORIGINAL NATIVE row.
// Original map deserialization sorts rows; this policy never assumes stable
// ties or applies source-file order as a substitute for executing that reader.
export const NATIVE_CLIP_MAP_POLICY = Object.freeze({
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  decoderImageSha256:
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
  classHash: "f5fb07c7",
  fieldHash: "45e122f8",
  constructionPrefix: Object.freeze([0x15afe30, 0x15afffc]),
  queryCallsite: Object.freeze([0x15aff41, 0x15aff73]),
  queryHelperRva: 0xa1670,
  sourceBlocks: Object.freeze([
    {
      rva: 0x15afe30,
      size: 38,
      sha256:
        "b44a819501327b7bc605d0952a938d91d0f76ccf6c2e0e7ac4e96fe1fe6c9d07",
    },
    {
      rva: 0x15aff41,
      size: 50,
      sha256:
        "915237d8ba44f76896f006243a8c5e115829f84ba61afc2e32e8d8eee5f522b2",
    },
    {
      rva: 0x15aff73,
      size: 9,
      sha256:
        "c42eae30d9ccc8c6c6a4ca22c6411599dfe2fe32a8a854dbfbc092f452b1aa07",
    },
  ]),
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unsigned = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

export function resolveNativeClipMap({
  entries,
  observationBytes,
  sourceBinSha256,
  ownerPath,
  trail = [],
}) {
  if (!(observationBytes instanceof Uint8Array) || !digest(sourceBinSha256))
    throw Error("Digest-bound original clip-map observation required");
  const proof = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(observationBytes),
  );
  const policy = NATIVE_CLIP_MAP_POLICY;
  if (
    proof.schema !== 1 ||
    proof.kind !== "original-duplicate-bin-map-observations" ||
    proof.build !== policy.build ||
    proof.protocol !== policy.protocol ||
    proof.decoderImageSha256 !== policy.decoderImageSha256 ||
    proof.sourceBinSha256 !== sourceBinSha256 ||
    !digest(proof.inputSha256) ||
    proof.boundary !== null ||
    proof.scope?.originalTypedReaderExecuted !== true ||
    proof.scope.animationGraphPrepared !== false ||
    !Array.isArray(proof.originalBlocks) ||
    !proof.originalBlocks.length ||
    !proof.sources ||
    !Object.keys(proof.sources).length ||
    !Object.values(proof.sources).every(digest)
  )
    throw Error("Unsupported original clip-map proof boundary");
  if (
    policy.sourceBlocks.some(
      (block) => !proof.originalBlocks.some((actual) => same(actual, block)),
    )
  )
    throw Error("Original clip-map cache instructions differ");
  const matches = proof.cases?.filter(
    (entry) =>
      entry.classHash === policy.classHash &&
      entry.fieldHash === policy.fieldHash &&
      entry.ownerPath === ownerPath &&
      same(entry.trail, trail),
  );
  if (matches?.length !== 1)
    throw Error("Unique original graph clip-map observation required");
  const observed = matches[0],
    rows = observed.nativeRows,
    lookup = observed.lookup;
  if (
    !Array.isArray(entries) ||
    entries.length < 1 ||
    entries.length > 100000 ||
    observed.originalEntries !== entries.length ||
    !Array.isArray(rows) ||
    rows.length !== entries.length ||
    observed.lookupConsumerExecuted !== true ||
    !lookup ||
    !same(lookup.constructionPrefix, policy.constructionPrefix) ||
    !same(lookup.queryCallsite, policy.queryCallsite) ||
    lookup.queryHelperRva !== policy.queryHelperRva ||
    lookup.existingCacheUnchanged !== true ||
    lookup.fullGraphPreparationExecuted !== false
  )
    throw Error("Original graph cache construction and query proof required");
  const originals = new Map(),
    native = new Map();
  entries.forEach((entry, index) => {
    if (
      entry?.key?.type !== "Hash" ||
      !unsigned(entry.key.value) ||
      !/^[a-f0-9]{8}$/.test(entry.value?.classHash ?? "")
    )
      throw Error("Preserved original typed clip-map entries required");
    const identity = `${entry.key.value}:${entry.value.classHash}`;
    const indices = originals.get(identity) ?? [];
    indices.push(index);
    originals.set(identity, indices);
  });
  rows.forEach((row, index) => {
    if (
      row.index !== index ||
      !unsigned(row.key) ||
      !/^[a-f0-9]{8}$/.test(row.classHash ?? "") ||
      (index > 0 && rows[index - 1].key > row.key)
    )
      throw Error("Bounded sorted original native clip-map rows required");
    const identity = `${row.key}:${row.classHash}`;
    native.set(identity, (native.get(identity) ?? 0) + 1);
  });
  if (
    native.size !== originals.size ||
    [...originals].some(([id, indices]) => native.get(id) !== indices.length)
  )
    throw Error("Original native rows differ from preserved source entries");
  const lastByKey = new Map(rows.map((row) => [row.key, row]));
  const query = rows[lookup.selectedIndex];
  if (
    !query ||
    query.classHash !== lookup.selectedClassHash ||
    lastByKey.get(query.key) !== query ||
    lookup.cacheEntries !== lastByKey.size ||
    !observed.nativeDuplicateRows?.some((row) => row.key === query.key)
  )
    throw Error("Original duplicate-key query contradicts the cache policy");
  const selectedEntries = [...lastByKey].map(([key, row]) => {
    const indices = originals.get(`${key}:${row.classHash}`);
    if (indices.length !== 1)
      throw Error(
        "Native selected row has ambiguous same-class source identity",
      );
    const sourceIndex = indices[0];
    return {
      key,
      sourceIndex,
      nativeIndex: row.index,
      value: entries[sourceIndex].value,
    };
  });
  return {
    policy: "original-graph-cache-last-native-row-v1",
    selectedEntries,
    originalEntries: entries,
    nativeRows: rows,
    provenance: {
      build: policy.build,
      protocol: policy.protocol,
      classHash: policy.classHash,
      fieldHash: policy.fieldHash,
      sourceBinSha256,
      observationSha256: sha(observationBytes),
      originalReaderInputSha256: proof.inputSha256,
    },
    scope: {
      nativeClipKeyLookup: true,
      fullGraphPreparation: false,
      nativeSpectatorEquivalent: false,
    },
  };
}
