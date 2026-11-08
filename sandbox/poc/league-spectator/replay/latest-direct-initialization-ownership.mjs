// Only producer-owned byte spans may leave the main thread. A compilation
// producer may reuse exact same-path pose spans through their private owner;
// the complete compiler inventory remains present and each buffer transfers once.
// Metadata checks enumerate known producer records, never the replay report or
// numeric keys of a large byte view. These capabilities do not establish asset
// content correctness; the worker still replays the exact hash-pinned compiler.
const groups = new WeakMap(),
  tickets = new WeakMap();
const MAX_PRODUCER_RECORDS = 8192;
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const typedBuffer = Object.getOwnPropertyDescriptor(typed, "buffer").get;
const typedOffset = Object.getOwnPropertyDescriptor(typed, "byteOffset").get;
const typedLength = Object.getOwnPropertyDescriptor(typed, "byteLength").get;
const bufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
).get;
const dataBuffer = Object.getOwnPropertyDescriptor(
  DataView.prototype,
  "buffer",
).get;
const dataOffset = Object.getOwnPropertyDescriptor(
  DataView.prototype,
  "byteOffset",
).get;
const dataLength = Object.getOwnPropertyDescriptor(
  DataView.prototype,
  "byteLength",
).get;
const plain = (v) =>
  v !== null &&
  typeof v === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const pathValid = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 512 &&
  /^[-A-Za-z0-9_./]+$/.test(v) &&
  !v.startsWith("/") &&
  !v.split("/").some((s) => s === ".." || s === "");
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function own(o, k) {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (!d || !Object.hasOwn(d, "value"))
    throw Error(`Own initialization data required: ${k}`);
  return d.value;
}
function record(o, keys) {
  if (
    !plain(o) ||
    Reflect.ownKeys(o).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(o, k))
  )
    throw Error("Exact plain initialization producer record required");
  for (const k of keys) own(o, k);
}
function dense(a, n = null) {
  if (!Array.isArray(a) || Object.getPrototypeOf(a) !== Array.prototype)
    throw Error("Plain initialization array required");
  const size = own(a, "length");
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_PRODUCER_RECORDS ||
    (n !== null && size !== n) ||
    Reflect.ownKeys(a).length !== size + 1
  )
    throw Error("Dense bounded initialization array required");
  for (let i = 0; i < size; i++) own(a, String(i));
  return size;
}
// Intrinsic getters avoid calling shadowed properties. In particular, do not
// Reflect.ownKeys a 65 MB Uint8Array just to check four sensitive properties.
export function directInitializationViewSpan(view, { uint8Only = false } = {}) {
  let buffer, byteOffset, byteLength;
  try {
    buffer = typedBuffer.call(view);
    byteOffset = typedOffset.call(view);
    byteLength = typedLength.call(view);
  } catch (error) {
    if (uint8Only) throw Error("Exact initialization Uint8Array required");
    try {
      buffer = dataBuffer.call(view);
      byteOffset = dataOffset.call(view);
      byteLength = dataLength.call(view);
    } catch {
      throw Error("Initialization buffer view required");
    }
  }
  if (uint8Only && Object.getPrototypeOf(view) !== Uint8Array.prototype)
    throw Error("Exact initialization Uint8Array prototype required");
  for (const key of ["buffer", "byteOffset", "byteLength", "constructor"])
    if (Object.getOwnPropertyDescriptor(view, key))
      throw Error("Shadowed initialization view property rejected");
  let bytes;
  try {
    bytes = directInitializationArrayBufferBytes(buffer);
  } catch {
    throw Error("Non-shared plain initialization ArrayBuffer required");
  }
  return { buffer, byteOffset, byteLength, bufferBytes: bytes };
}
export function directInitializationArrayBufferBytes(buffer) {
  const bytes = bufferLength.call(buffer);
  if (
    Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
    Object.getOwnPropertyDescriptor(buffer, "byteLength") ||
    Object.getOwnPropertyDescriptor(buffer, "constructor")
  )
    throw Error("Plain unshadowed initialization ArrayBuffer required");
  return bytes;
}
function copyBytes(source, seen) {
  const span = directInitializationViewSpan(source, { uint8Only: true });
  if (
    span.byteOffset !== 0 ||
    span.byteLength !== span.bufferBytes ||
    span.byteLength === 0 ||
    seen.has(span.buffer)
  )
    throw Error("Independent complete initialization byte spans required");
  seen.add(span.buffer);
  const value = new Uint8Array(span.byteLength);
  Uint8Array.prototype.set.call(value, source);
  return value;
}
function mint(
  scope,
  value,
  views,
  started,
  details = null,
  borrowedFrom = null,
) {
  const ownership = Object.freeze({});
  groups.set(ownership, {
    scope,
    value,
    spans: views.map((view) => ({
      view,
      ...directInitializationViewSpan(view, { uint8Only: true }),
    })),
    claimed: false,
    producerPreparationCpuMs: performance.now() - started,
    details,
    borrowedFrom,
  });
  return Object.freeze({ value, ownership });
}
export function copyDirectCompilationInitialization(
  entries,
  options = { viewerPoseInitialization: null },
) {
  record(options, ["viewerPoseInitialization"]);
  const viewer = own(options, "viewerPoseInitialization");
  let poseOwner = null;
  if (viewer !== null) {
    if (!plain(viewer)) throw Error("Owned viewer pose producer required");
    poseOwner = groups.get(own(viewer, "ownership"));
    if (
      !poseOwner ||
      poseOwner.scope !== "viewerPoseAssets" ||
      poseOwner.claimed ||
      poseOwner.value !== own(viewer, "value")
    )
      throw Error("Unused owned viewer pose producer required");
  }
  const started = performance.now(),
    count = dense(entries),
    seen = new Set(),
    paths = new Set(),
    views = [],
    value = [];
  let borrowedBytes = 0,
    borrowedCount = 0;
  if (!count) throw Error("Nonempty compilation input inventory required");
  let previous = null;
  for (let i = 0; i < count; i++) {
    const entry = own(entries, String(i));
    dense(entry, 2);
    const path = own(entry, "0");
    if (
      !pathValid(path) ||
      paths.has(path) ||
      (previous !== null && previous.localeCompare(path) >= 0)
    )
      throw Error("Unique ordered compilation input paths required");
    paths.add(path);
    previous = path;
    const source = own(entry, "1"),
      shared =
        poseOwner && Object.hasOwn(poseOwner.value.packages, path)
          ? own(poseOwner.value.packages, path)
          : null;
    let bytes;
    if (shared !== null) {
      const input = directInitializationViewSpan(source, { uint8Only: true }),
        target = directInitializationViewSpan(shared, { uint8Only: true });
      if (
        input.byteOffset !== 0 ||
        input.byteLength === 0 ||
        input.byteLength !== input.bufferBytes ||
        seen.has(input.buffer) ||
        target.byteLength !== input.byteLength
      )
        throw Error("Exact shared static input span required");
      seen.add(input.buffer);
      for (let j = 0; j < input.byteLength; j++)
        if (source[j] !== shared[j])
          throw Error("Shared static input bytes differ: " + path);
      bytes = shared;
      borrowedBytes += target.byteLength;
      borrowedCount++;
    } else {
      bytes = copyBytes(source, seen);
      views.push(bytes);
    }
    value.push(Object.freeze([path, bytes]));
  }
  return mint(
    "compilationInputs",
    Object.freeze(value),
    views,
    started,
    borrowedCount
      ? {
          borrowedStaticInputCount: borrowedCount,
          borrowedStaticInputBytes: borrowedBytes,
          sharedNativeImage: value.some(
            ([path, bytes]) =>
              path === "decoder-16.21-macos/image.bin" &&
              bytes === poseOwner?.value.packages[path],
          ),
        }
      : null,
    borrowedCount ? poseOwner : null,
  );
}
export function copyDirectViewerPoseInitialization(source) {
  const started = performance.now();
  record(source, ["schema", "policy", "contentHash", "hashes", "packages"]);
  const schema = own(source, "schema"),
    policy = own(source, "policy"),
    contentHash = own(source, "contentHash"),
    inputHashes = own(source, "hashes"),
    inputPackages = own(source, "packages");
  if (
    schema !== 1 ||
    typeof policy !== "string" ||
    !policy ||
    !hash(contentHash) ||
    !plain(inputHashes) ||
    !plain(inputPackages)
  )
    throw Error("Explicit viewer pose initialization bundle required");
  const hashes = {},
    packages = {},
    seen = new Set(),
    views = [];
  const hashKeys = Reflect.ownKeys(inputHashes),
    packageKeys = Reflect.ownKeys(inputPackages);
  if (
    !hashKeys.length ||
    hashKeys.length > MAX_PRODUCER_RECORDS ||
    hashKeys.length !== packageKeys.length
  )
    throw Error(
      "Complete bounded viewer pose initialization inventory required",
    );
  for (const path of hashKeys) {
    const digest = own(inputHashes, path);
    if (!pathValid(path) || !hash(digest))
      throw Error("Bounded viewer pose content hashes required");
    Object.defineProperty(hashes, path, { value: digest, enumerable: true });
  }
  let nativeImage = null;
  for (const path of packageKeys) {
    if (!pathValid(path) || !Object.hasOwn(hashes, path))
      throw Error("Hash-owned viewer pose byte path required");
    const copiedAt = performance.now(),
      bytes = copyBytes(own(inputPackages, path), seen);
    if (path === "decoder-16.21-macos/image.bin")
      nativeImage = {
        bytes: bytes.length,
        copyCpuMs: performance.now() - copiedAt,
        copies: 1,
      };
    views.push(bytes);
    Object.defineProperty(packages, path, { value: bytes, enumerable: true });
  }
  const value = Object.freeze({
    schema,
    policy,
    contentHash,
    hashes: Object.freeze(hashes),
    packages: Object.freeze(packages),
  });
  const produced = mint(
    "viewerPoseAssets",
    value,
    views,
    started,
    nativeImage === null ? null : { nativeImage },
  );
  return nativeImage === null
    ? produced
    : Object.freeze({
        ...produced,
        initializationMetrics: Object.freeze({
          nativeImage: Object.freeze({ ...nativeImage }),
        }),
      });
}
function payloadPackages(payload) {
  if (!plain(payload))
    throw Error("Plain session initialization payload required");
  const packages = own(payload, "packages");
  if (!plain(packages))
    throw Error("Plain session initialization package map required");
  return packages;
}
export function createDirectInitializationTransfer(payload, ownerships) {
  const started = performance.now(),
    packages = payloadPackages(payload),
    count = dense(ownerships),
    selected = [],
    scopes = new Set(),
    buffers = new Set();
  if (count !== 2)
    throw Error("Compilation and pose producer ownership required");
  for (let i = 0; i < count; i++) {
    const group = groups.get(own(ownerships, String(i)));
    if (
      !group ||
      group.claimed ||
      scopes.has(group.scope) ||
      own(packages, group.scope) !== group.value
    )
      throw Error("Unused exact producer ownership required");
    for (const span of group.spans) {
      if (buffers.has(span.buffer))
        throw Error("Initialization producer buffers alias");
      buffers.add(span.buffer);
    }
    scopes.add(group.scope);
    selected.push(group);
  }
  if (!scopes.has("compilationInputs") || !scopes.has("viewerPoseAssets"))
    throw Error("Both session initialization producers required");
  for (const group of selected)
    if (group.borrowedFrom !== null && !selected.includes(group.borrowedFrom))
      throw Error(
        "Shared static inputs require their exact pose producer owner",
      );
  for (const group of selected) group.claimed = true;
  const ticket = Object.freeze({});
  tickets.set(ticket, {
    payload,
    packages,
    groups: selected,
    used: false,
    ticketPreparationCpuMs: performance.now() - started,
  });
  return ticket;
}
export function consumeDirectInitializationTransfer(ticket, payload) {
  const plan = tickets.get(ticket);
  if (!plan || plan.used)
    throw Error("Unused session initialization transfer capability required");
  plan.used = true;
  if (plan.payload !== payload || payloadPackages(payload) !== plan.packages)
    throw Error("Session initialization payload was replaced");
  const transfers = [],
    scopes = [];
  let transferredBufferBytes = 0,
    producerPreparationCpuMs = 0;
  for (const group of plan.groups) {
    if (own(plan.packages, group.scope) !== group.value)
      throw Error("Initialization producer payload was replaced");
    let bytes = 0;
    for (const expected of group.spans) {
      const span = directInitializationViewSpan(expected.view, {
        uint8Only: true,
      });
      if (
        span.buffer !== expected.buffer ||
        span.byteOffset !== 0 ||
        span.byteLength !== expected.byteLength ||
        span.bufferBytes !== expected.bufferBytes ||
        span.byteLength === 0
      )
        throw Error("Initialization producer span changed or detached");
      transfers.push(span.buffer);
      bytes += span.byteLength;
    }
    transferredBufferBytes += bytes;
    producerPreparationCpuMs += group.producerPreparationCpuMs;
    scopes.push({
      scope: group.scope,
      buffers: group.spans.length,
      bytes,
      producerPreparationCpuMs: group.producerPreparationCpuMs,
      ...(group.details === null
        ? {}
        : { details: structuredClone(group.details) }),
    });
  }
  return {
    transfers,
    transferredBufferBytes,
    transferredBuffers: transfers.length,
    producerPreparationCpuMs,
    ticketPreparationCpuMs: plan.ticketPreparationCpuMs,
    scopes,
  };
}
