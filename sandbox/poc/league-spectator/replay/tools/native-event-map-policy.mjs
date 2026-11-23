import { createHash } from "node:crypto";
import { NATIVE_CLIP_MAP_POLICY } from "./native-clip-map-policy.mjs";

export const NATIVE_EVENT_MAP_POLICY = Object.freeze({
  build: NATIVE_CLIP_MAP_POLICY.build,
  protocol: NATIVE_CLIP_MAP_POLICY.protocol,
  decoderImageSha256: NATIVE_CLIP_MAP_POLICY.decoderImageSha256,
  classHash: "5bd9a1e6",
  fieldHash: "f598463e",
  originalMethodRva: 0x15b7050,
  iterationBlock: Object.freeze([0x15b7216, 0x15b7249]),
  sourceBlocks: Object.freeze([
    {
      rva: 0x15b7216,
      size: 9,
      sha256:
        "38e2bc1b65b22c6edf9834270afde0f3640a55c920d97ee0c6ec9d2d2dcfe2c0",
    },
    {
      rva: 0x15b7230,
      size: 16,
      sha256:
        "c0af72ab757d7654e14305a99641a534d0b1830c66f0a21de9159703b05c3378",
    },
    {
      rva: 0x15b7240,
      size: 9,
      sha256:
        "85a6bd738db439d49f683d330985c01233ec7e6fe067fcd4c20e1fda49cc9204",
    },
  ]),
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const unsigned = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

// Atomic preparation visits every original row and invokes every event's
// virtual callback. Duplicate event keys are retained, with distinct row IDs.
// This proves preparation iteration only, not later event scheduling/drawing.
export function retainNativeEventMap({
  entries,
  observationBytes,
  sourceBinSha256,
  ownerPath,
  trail = [],
}) {
  if (!(observationBytes instanceof Uint8Array) || !digest(sourceBinSha256))
    throw Error("Digest-bound original event-map observation required");
  const proof = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(observationBytes),
  );
  const policy = NATIVE_EVENT_MAP_POLICY;
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
    policy.sourceBlocks.some(
      (block) => !proof.originalBlocks.some((actual) => same(block, actual)),
    ) ||
    !proof.sources ||
    !Object.keys(proof.sources).length ||
    !Object.values(proof.sources).every(digest)
  )
    throw Error("Unsupported original event-map proof boundary");
  const cases = proof.cases?.filter(
    (entry) =>
      entry.classHash === policy.classHash &&
      entry.fieldHash === policy.fieldHash &&
      entry.ownerPath === ownerPath &&
      same(entry.trail, trail),
  );
  if (cases?.length !== 1)
    throw Error("Unique original Atomic event-map observation required");
  const observed = cases[0],
    rows = observed.nativeRows,
    preparation = observed.eventPreparation;
  if (
    !Array.isArray(entries) ||
    !entries.length ||
    entries.length > 100000 ||
    observed.originalEntries !== entries.length ||
    !Array.isArray(rows) ||
    rows.length !== entries.length ||
    !preparation ||
    preparation.originalMethodRva !== policy.originalMethodRva ||
    !same(preparation.iterationBlock, policy.iterationBlock) ||
    preparation.originalCallbacksExecuted !== true ||
    preparation.context !== "original-empty-graph-constructor" ||
    preparation.animationResourceLookupExecuted !== false ||
    preparation.eventSchedulingExecuted !== false ||
    preparation.fullGraphPreparationExecuted !== false ||
    preparation.calls?.length !== rows.length
  )
    throw Error("Complete original Atomic event preparation proof required");
  const originals = new Map();
  entries.forEach((entry, index) => {
    if (
      entry?.key?.type !== "Hash" ||
      !unsigned(entry.key.value) ||
      !/^[a-f0-9]{8}$/.test(entry.value?.classHash ?? "")
    )
      throw Error("Preserved original typed event-map entries required");
    const id = `${entry.key.value}:${entry.value.classHash}`;
    if (originals.has(id))
      throw Error("Native event row has ambiguous same-class source identity");
    originals.set(id, index);
  });
  const seen = new Set();
  const eventEntries = rows.map((row, index) => {
    const call = preparation.calls[index],
      id = `${row.key}:${row.classHash}`,
      sourceIndex = originals.get(id);
    if (
      row.index !== index ||
      !unsigned(row.key) ||
      (index > 0 && rows[index - 1].key > row.key) ||
      sourceIndex === undefined ||
      seen.has(id) ||
      call.index !== index ||
      call.key !== row.key ||
      call.classHash !== row.classHash ||
      !Number.isSafeInteger(call.callbackRva) ||
      call.callbackRva < 0
    )
      throw Error(
        "Original event rows/callbacks differ from preserved source entries",
      );
    seen.add(id);
    return {
      key: row.key,
      sourceIndex,
      nativeIndex: index,
      value: entries[sourceIndex].value,
    };
  });
  return {
    policy: "original-atomic-event-all-native-rows-v1",
    eventEntries,
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
      originalPreparationIteration: true,
      eventScheduling: false,
      fullGraphPreparation: false,
      nativeSpectatorEquivalent: false,
    },
  };
}
