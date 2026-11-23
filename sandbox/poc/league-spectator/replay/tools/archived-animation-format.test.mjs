import { expect, test } from "bun:test";
import {
  archivedAnimationFormat,
  completeActorAnimationCatalog,
} from "./archived-animation-format.mjs";
import { verifyNativeAnimationExport } from "./archived-animation-export.mjs";
import { createHash } from "node:crypto";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hash = "a".repeat(64),
  rigHash = "b".repeat(64);
function header(magic, version) {
  const bytes = new Uint8Array(40);
  bytes.set(new TextEncoder().encode(magic));
  new DataView(bytes.buffer).setUint32(8, version, true);
  return bytes;
}
test("routing is declared by exact original format, never converter failure", () => {
  expect(archivedAnimationFormat(header("r3d2canm", 1)).evaluator).toBe(
    "original-native-compressed-v1",
  );
  for (const version of [3, 4, 5])
    expect(archivedAnimationFormat(header("r3d2anmd", version)).evaluator).toBe(
      "pinned-toolkit-uncompressed",
    );
  expect(() => archivedAnimationFormat(header("r3d2canm", 2))).toThrow(
    "Unadmitted",
  );
  expect(() => archivedAnimationFormat(header("garbage!", 1))).toThrow(
    "Unadmitted",
  );
  expect(() => archivedAnimationFormat(new Uint8Array(12))).toThrow("Bounded");
});
test("publication requires complete correctly selected resources and retains all aliases", () => {
  const record = {
    file: "animations/0.anm",
    outputFile: "clips/0.clip",
    names: ["idle", "run"],
    sourceSha256: hash,
    evaluator: "original-native-compressed-v1",
  };
  const plan = { rigJoints: ["root"], records: [record] };
  const resource = {
    evaluator: record.evaluator,
    frames: 3,
    fps: 30,
    duration: 0.1,
    sha256: hash,
  };
  expect(() => completeActorAnimationCatalog(plan, new Map())).toThrow(
    "no admitted complete",
  );
  expect(() =>
    completeActorAnimationCatalog(
      plan,
      new Map([
        [hash, { ...resource, evaluator: "pinned-toolkit-uncompressed" }],
      ]),
    ),
  ).toThrow("no admitted complete");
  const catalog = completeActorAnimationCatalog(
    plan,
    new Map([[hash, resource]]),
  );
  expect(Object.keys(catalog.clips)).toEqual(["idle", "run"]);
  expect(catalog.clips.run.evaluator).toBe("original-native-compressed-v1");
  expect(() =>
    completeActorAnimationCatalog(
      { ...plan, records: [record, record] },
      new Map([[hash, resource]]),
    ),
  ).toThrow("Duplicate");
});
function nativeFixture() {
  const header = new TextEncoder().encode(
    JSON.stringify({
      schema: 1,
      frames: 2,
      fps: 30,
      duration: 0.05,
      tracks: [],
    }),
  );
  const bytes = new Uint8Array(4 + header.length);
  new DataView(bytes.buffer).setUint32(0, header.length, true);
  bytes.set(header, 4);
  const sources = { "original.py": hash };
  const report = {
    schema: 1,
    kind: "original-archived-compressed-animation-probe",
    build: "16.21.829.8620",
    boundary: null,
    sourceSha256: hash,
    rigSha256: rigHash,
    resourceFrames: 2,
    resourceFps: 30,
    scope: {
      originalResourceConstructor: true,
      originalRigBinding: true,
      originalCacheConstructor: true,
      originalEvaluator: true,
      nativeFidelityAdmission: false,
    },
    nativeClip: {
      frames: 2,
      fps: 30,
      duration: 0.05,
      tracks: 0,
      sha256: sha(bytes),
    },
    samples: [
      { finite: true, localPosesHex: "00" },
      { finite: true, localPosesHex: "01" },
      { finite: true, localPosesHex: "00" },
      { finite: true, localPosesHex: "02" },
    ],
    originalBlocks: [{ rva: 1 }],
    sources,
  };
  return {
    report,
    clipBytes: bytes,
    sourceSha256: hash,
    rigSha256: rigHash,
    sourceFiles: sources,
  };
}
test("native resource receipt rejects rig/source drift, partial frames, altered output and broken rewind", () => {
  expect(verifyNativeAnimationExport(nativeFixture()).frames).toBe(2);
  for (const mutate of [
    (value) => (value.rigSha256 = hash),
    (value) => (value.sourceSha256 = rigHash),
    (value) => value.report.samples.pop(),
    (value) => (value.report.boundary = {}),
    (value) => (value.sourceFiles = {}),
    (value) => (value.report.samples[2].localPosesHex = "bad"),
    (value) => (value.clipBytes[4] ^= 1),
  ]) {
    const input = nativeFixture();
    mutate(input);
    expect(() => verifyNativeAnimationExport(input)).toThrow();
  }
});

test("native cache cannot cross an interpreter or emulator identity change", () => {
  const input = nativeFixture();
  input.report.runtime = { fingerprint: hash };
  expect(
    verifyNativeAnimationExport({ ...input, runtimeFingerprint: hash }).frames,
  ).toBe(2);
  expect(() =>
    verifyNativeAnimationExport({ ...input, runtimeFingerprint: rigHash }),
  ).toThrow("runtime differs");
});
