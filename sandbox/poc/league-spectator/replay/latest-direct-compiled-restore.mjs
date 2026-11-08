import { sha256 } from "./structural-comparison.mjs";
import {
  directInitializationViewSpan,
  directInitializationArrayBufferBytes,
} from "./latest-direct-initialization-ownership.mjs";
export const DIRECT_DIAGNOSTIC_COMPILATION_MODE =
  "diagnostic-child-free-component-projection-v1";
const plain = (v) =>
  v !== null &&
  typeof v === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const typedPrototypes = [
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array,
  DataView,
].map((c) => c.prototype);
export function assertDirectCompiledDataGraph(value, seen = new Set()) {
  if (
    value === null ||
    ["undefined", "string", "boolean"].includes(typeof value)
  )
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw Error("Finite compiled scalar required");
    return;
  }
  if (typeof value !== "object" || seen.has(value))
    throw Error("Acyclic own-data compiled graph required");
  seen.add(value);
  if (ArrayBuffer.isView(value)) {
    if (
      !typedPrototypes.includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(
        (k) =>
          typeof k !== "string" ||
          !/^(0|[1-9]\d*)$/.test(k) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), "value"),
      ) ||
      (Object.getPrototypeOf(value) === DataView.prototype &&
        Reflect.ownKeys(value).length !== 0) ||
      !(value.buffer instanceof ArrayBuffer)
    )
      throw Error("Owned typed compiled data required");
  } else if (value instanceof ArrayBuffer) {
    if (
      Object.getPrototypeOf(value) !== ArrayBuffer.prototype ||
      Reflect.ownKeys(value).length
    )
      throw Error("Plain compiled buffer required");
  } else {
    if (
      Array.isArray(value)
        ? Object.getPrototypeOf(value) !== Array.prototype
        : !plain(value)
    )
      throw Error("Plain compiled object required");
    for (const key of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        key === "toJSON" ||
        !Object.hasOwn(d, "value")
      )
        throw Error("Own data compiled fields required");
      if (Array.isArray(value) && key !== "length" && !/^\d+$/.test(key))
        throw Error("Dense compiled array required");
      assertDirectCompiledDataGraph(d.value, seen);
    }
    if (
      Array.isArray(value) &&
      Reflect.ownKeys(value).length !== value.length + 1
    )
      throw Error("Dense compiled array required");
  }
  seen.delete(value);
}
export function sameDirectCompiledData(a, b) {
  if (
    typeof a !== "object" ||
    a === null ||
    typeof b !== "object" ||
    b === null
  )
    return Object.is(a, b);
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (
      !ArrayBuffer.isView(a) ||
      !ArrayBuffer.isView(b) ||
      a.constructor !== b.constructor ||
      a.byteLength !== b.byteLength
    )
      return false;
    const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
      right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return left.every((v, i) => v === right[i]);
  }
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) {
    if (
      !(a instanceof ArrayBuffer) ||
      !(b instanceof ArrayBuffer) ||
      a.byteLength !== b.byteLength
    )
      return false;
    const left = new Uint8Array(a),
      right = new Uint8Array(b);
    return left.every((v, i) => v === right[i]);
  }
  if (
    Array.isArray(a) !== Array.isArray(b) ||
    (!Array.isArray(a) && (!plain(a) || !plain(b)))
  )
    return false;
  const ak = Reflect.ownKeys(a),
    bk = Reflect.ownKeys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        typeof k === "string" &&
        Object.hasOwn(b, k) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(a, k), "value") &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(b, k), "value") &&
        sameDirectCompiledData(a[k], b[k]),
    )
  );
}
export function directInitializationBufferStats(payload) {
  const objects = new Set(),
    buffers = new Set();
  let viewBytes = 0;
  const visit = (v) => {
    if (v === null || typeof v !== "object" || objects.has(v)) return;
    objects.add(v);
    if (ArrayBuffer.isView(v)) {
      const span = directInitializationViewSpan(v);
      buffers.add(span.buffer);
      viewBytes += span.byteLength;
      return;
    }
    if (v instanceof ArrayBuffer) {
      directInitializationArrayBufferBytes(v);
      buffers.add(v);
      return;
    }
    for (const key of Reflect.ownKeys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (Object.hasOwn(d, "value")) visit(d.value);
    }
  };
  visit(payload);
  return {
    uniqueBuffers: buffers.size,
    uniqueBufferBytes: [...buffers].reduce(
      (n, b) => n + directInitializationArrayBufferBytes(b),
      0,
    ),
    referencedViewBytes: viewBytes,
    wireBytes: null,
  };
}
const childDeclared = (v) =>
  v !== null &&
  typeof v === "object" &&
  (Object.hasOwn(v, "childParticleSetDefinition") ||
    Object.values(v).some(childDeclared));
function diagnosticProjection(expected, supplied) {
  const emitters = supplied.emitters.map((e) => {
    const original = expected.emitters.find((p) => p.index === e.index);
    if (!original || childDeclared(original.source))
      throw Error(
        "Diagnostic projection requires admitted unchanged child-free emitters",
      );
    return original;
  });
  if (
    !emitters.length ||
    new Set(emitters.map((e) => e.index)).size !== emitters.length
  )
    throw Error("Unique nonempty diagnostic emitter subset required");
  return {
    ...expected,
    blockers: [],
    unsupported: [],
    childResourceAncestryRequired: false,
    childSiblingProgram: null,
    emitters,
    diagnosticRootProjection: {
      policy: "isolated-child-free-emitter-numeric-control-v1",
      originalDefinitionHash: expected.definitionHash,
      originalRootBlockers: [...expected.blockers],
      originalChildAncestryRequired:
        expected.childResourceAncestryRequired === true,
      nativeParentActivation: false,
      matchResourceAdmission: false,
    },
  };
}
// Replay the same owned static loader/compiler only during worker initialization.
// Normal inventory comes from ordered events, so deleting a serialized program
// cannot shrink the independently compiled expectation.
export async function restoreLatestDirectCompiledDefinitions(
  payload,
  { staticCatalog = null } = {},
) {
  const started = performance.now(),
    mode = payload.compilationMode ?? "normal";
  if (!["normal", DIRECT_DIAGNOSTIC_COMPILATION_MODE].includes(mode))
    throw Error("Explicit supported compilation mode required");
  assertDirectCompiledDataGraph(payload.definitions);
  if (
    !Array.isArray(payload.definitions) ||
    !Array.isArray(payload.events) ||
    !Array.isArray(payload.packages?.compilationInputs)
  )
    throw Error(
      "Complete captured compiler inputs and definition inventory required",
    );
  const effectIds = [
    ...new Set(
      payload.events.flatMap((e) =>
        [e.definitionId, e.auxiliaryCandidateDefinitionId].filter(
          (v) => v !== null && v !== undefined,
        ),
      ),
    ),
  ];
  if (
    effectIds.some((id) => typeof id !== "string" || !id.length) ||
    !sameDirectCompiledData(
      payload.definitions.map((d) => d.id),
      effectIds,
    )
  )
    throw Error("Compiled definition inventory differs from ordered events");
  const assets = new Map(),
    buffers = new Set();
  let inputBytes = 0;
  for (const entry of payload.packages.compilationInputs) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      entry[0].length > 512 ||
      !/^[-A-Za-z0-9_./]+$/.test(entry[0]) ||
      entry[0].startsWith("/") ||
      entry[0].split("/").some((p) => p === ".." || p === "") ||
      assets.has(entry[0]) ||
      !(entry[1] instanceof Uint8Array) ||
      !(entry[1].buffer instanceof ArrayBuffer) ||
      entry[1].byteOffset !== 0 ||
      entry[1].byteLength !== entry[1].buffer.byteLength ||
      buffers.has(entry[1].buffer)
    )
      throw Error(
        "Unique complete independently owned compiler input spans required",
      );
    assets.set(entry[0], entry[1]);
    buffers.add(entry[1].buffer);
    inputBytes += entry[1].byteLength;
  }
  const manifestBytes = assets.get("latest-effects/manifest.json"),
    used = new Set(["latest-effects/manifest.json"]);
  if (
    !manifestBytes ||
    (await sha256(manifestBytes)) !== payload.contract.contentHash
  )
    throw Error("Captured compiler manifest content differs");
  const { loadLatestDirectEffectPackage } =
    await import("./latest-direct-effect-package.mjs");
  const expected = await loadLatestDirectEffectPackage({
    load: async (path) => {
      const bytes = assets.get(path);
      if (!bytes) throw Error(`Captured compiler input missing: ${path}`);
      used.add(path);
      return bytes.slice();
    },
    manifestBytes: manifestBytes.slice(),
    effectIds,
    captureCompilationInputs: false,
    staticCatalog,
  });
  if (used.size !== assets.size)
    throw Error("Captured compiler input inventory has unconsumed assets");
  if (
    !sameDirectCompiledData(payload.profile, expected.profile) ||
    payload.contract.build !== expected.contract.build ||
    payload.contract.protocol !== expected.contract.protocol ||
    payload.contract.contentHash !== expected.contract.contentHash
  )
    throw Error("Restored compiler build/profile identity differs");
  for (const key of [
    "values",
    "birth",
    "emission",
    "samplers",
    "placement",
    "effectsManifest",
    "childSiblings",
  ])
    if (!sameDirectCompiledData(payload.packages[key], expected.packages[key]))
      throw Error(`Restored compiler static package differs: ${key}`);
  const definitions = new Map();
  for (const supplied of payload.definitions) {
    const original = expected.definitions.get(supplied.id),
      canonical =
        mode === DIRECT_DIAGNOSTIC_COMPILATION_MODE
          ? diagnosticProjection(original, supplied)
          : original;
    assertDirectCompiledDataGraph(canonical);
    if (!sameDirectCompiledData(supplied, canonical))
      throw Error(
        `Serialized compiled definition differs from owned recompile: ${supplied.id}`,
      );
    definitions.set(canonical.id, canonical);
  }
  return {
    definitions,
    kernels: expected.kernels,
    metrics: {
      mode,
      definitions: definitions.size,
      staticInputFiles: assets.size,
      staticInputBytes: inputBytes,
      recompileMs: performance.now() - started,
      perFrameRecompile: false,
    },
  };
}
