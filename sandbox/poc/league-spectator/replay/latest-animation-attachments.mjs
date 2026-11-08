import { NativeVfxSpawnKernel, spawnPreviewMath } from "./latest-vfx-spawn.mjs";
import { sha256 } from "./structural-comparison.mjs";

const owned = {
    rig: 0x10040000,
    joints: 0x10041000,
    pose: 0x10049000,
    poses: 0x10050000,
    position: 0x1002a000,
    contextVtable: 0x10030000,
    rawVtable: 0x10030100,
    wrapperVtable: 0x10030200,
    callbackBase: 0x10032000,
  },
  callbackNames = [
    "owner",
    "position",
    "create",
    "retain",
    "detached",
    "bone",
    "afterimage",
    "scalar",
    "playSpeed",
    "source",
    "target",
    "ownerBinding",
    "definition",
    "stop",
    "release",
    "speedUpdate",
  ],
  blocks = [
    [0x1594d20, 0x1594d80],
    [0x1594d80, 0x1595510],
    [0x1595510, 0x15955d0],
    [0x1594cc0, 0x1594d20],
    [0x157fe60, 0x1580010],
    [0x157f940, 0x157fb80],
    [0x15dc290, 0x15dc2ed],
    [0x15c1750, 0x15c17c5],
    [0x1779b60, 0x1779cbc],
    [0x16e7640, 0x16e7990],
    [0x15bc200, 0x15bc390],
  ],
  uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff,
  finite = (n) => typeof n === "number" && Number.isFinite(Math.fround(n)),
  hex = (bytes) =>
    Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
function bytes(value, size) {
  if (
    typeof value !== "string" ||
    value.length !== size * 2 ||
    !/^[0-9a-f]+$/.test(value)
  )
    throw Error("Invalid supplied animation transform bytes");
  const result = Uint8Array.from(value.match(/../g), (v) => parseInt(v, 16)),
    view = new DataView(result.buffer);
  for (let i = 0; i < size; i += 4)
    if (!Number.isFinite(view.getFloat32(i, true)))
      throw Error("Non-finite supplied animation transform");
  return result;
}
function validate(value) {
  const allowed = new Set([
    "effectKey",
    "secondaryKey",
    "ownerPositionHex",
    "joints",
    "pairs",
    "detachable",
    "poseAfterimage",
    "createSucceeds",
    "suppressed",
    "effectScalar",
    "scalePlaySpeed",
  ]);
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).some((k) => !allowed.has(k)) ||
    !uint(value.effectKey) ||
    !uint(Object.hasOwn(value, "secondaryKey") ? value.secondaryKey : 0) ||
    !finite(Object.hasOwn(value, "effectScalar") ? value.effectScalar : 1) ||
    !Array.isArray(value.joints) ||
    value.joints.length > 256 ||
    !Array.isArray(value.pairs) ||
    value.pairs.length > 512
  )
    throw Error("Invalid animation attachment input");
  for (const [key, fallback] of [
    ["detachable", false],
    ["poseAfterimage", false],
    ["createSucceeds", true],
    ["suppressed", false],
    ["scalePlaySpeed", false],
  ])
    if (
      typeof (Object.hasOwn(value, key) ? value[key] : fallback) !== "boolean"
    )
      throw Error("Invalid animation attachment flag");
  if (value.scalePlaySpeed)
    throw Error("Animation speed-context lookup is not admitted");
  const hashes = new Set();
  for (const joint of value.joints) {
    if (
      !joint ||
      Object.keys(joint).some(
        (k) => !["hash", "resolvedBoneKey", "transformHex"].includes(k),
      ) ||
      !uint(joint.hash) ||
      !uint(joint.resolvedBoneKey) ||
      hashes.has(joint.hash)
    )
      throw Error("Invalid supplied rig hash mapping");
    hashes.add(joint.hash);
    bytes(joint.transformHex, 40);
  }
  for (const pair of value.pairs)
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(uint))
      throw Error("Invalid source/target bone hash pair");
  bytes(value.ownerPositionHex, 12);
}

// Original binding decisions on supplied maps/poses, with explicit request
// sinks for context, effect and transform factories. No particles are created.
export async function createLatestAnimationAttachments(
  uc,
  profile,
  image,
  spawnBytes,
  definitionBytes,
) {
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(definitionBytes)) !== profile.animationAttachmentsSha256
  )
    throw Error("Animation attachment package hash mismatch");
  const meta = JSON.parse(new TextDecoder().decode(definitionBytes)),
    spawn = JSON.parse(new TextDecoder().decode(spawnBytes)),
    imageBytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (
    meta.schema !== 1 ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    meta.animationEventsSha256 !== profile.animationEventsSha256 ||
    meta.animationRigsSha256 !== profile.animationRigsSha256 ||
    meta.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    spawn.runtimeSha256 !== meta.runtimeSha256 ||
    spawn.build !== meta.build ||
    spawn.protocol !== meta.protocol ||
    meta.activationRva !== 0x1594d20 ||
    meta.cleanupRva !== 0x1595510 ||
    JSON.stringify(meta.owned) !== JSON.stringify(owned) ||
    JSON.stringify(meta.callbacks) !==
      JSON.stringify(Object.fromEntries(callbackNames.map((n, i) => [n, i]))) ||
    JSON.stringify(meta.sourceBlocks.map((b) => [b.startRva, b.endRva])) !==
      JSON.stringify(blocks)
  )
    throw Error("Unsupported animation attachment source");
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(imageBytes.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Animation attachment code changed");
  const k = new NativeVfxSpawnKernel(
      uc,
      profile,
      imageBytes,
      spawn,
      null,
      spawnPreviewMath,
    ),
    e = k.engine,
    a = spawn.addresses;
  let handles = new Map(),
    wrappers = new Map(),
    proxies = new Map(),
    requests = [],
    runtime = null,
    defaultSystem,
    createSucceeds = true,
    closed = false,
    poisoned = false;
  const ensureOpen = () => {
      if (closed) throw Error("Closed animation attachment kernel");
    },
    ensureReady = () => {
      ensureOpen();
      if (runtime === null || poisoned)
        throw Error("Animation attachment requires activation");
    },
    initializeHeap = () => {
      k.nextHeap = 0x10400000;
      k.allocations = new Map();
      k.services = {};
      k.births = [];
      k.mathCalls = [];
    },
    take = (map, key) => {
      if (!map.has(key)) throw Error("Unowned animation attachment boundary");
      return map.get(key);
    },
    outputState = () => ({
      requests: structuredClone(requests),
      retained: k.readU32(runtime + 0x30),
    });
  initializeHeap();
  e.hook_add(
    uc.HOOK_CODE,
    () => e.emu_stop(),
    null,
    k.base + 0x14aa516,
    k.base + 0x14aa516,
  );
  k.callNative(0x14aa3bf, {}, 0x14aa516);
  k.callNative(0x1779b60, { RDI: a.systemDefinition });
  defaultSystem = k.read(a.systemDefinition, 0x160);
  if (defaultSystem[0xc7] !== 0)
    throw Error("Native pose-afterimage default changed");

  function callback(name) {
    const [di, si, dx, cx, r8] = ["RDI", "RSI", "RDX", "RCX", "R8"].map((r) =>
      Number(e.reg_read_i64(uc[`X86_REG_${r}`])),
    );
    let result;
    if (name === "owner") result = a.actor;
    else if (name === "position") result = owned.position;
    else if (name === "create") {
      const effect = handles.size;
      requests.push({
        kind: "create-effect-request",
        effect,
        effectKey: k.readU32(si),
        secondaryKey: k.readU32(dx),
        positionHex: hex(k.read(r8, 12)),
        created: createSucceeds,
      });
      if (createSucceeds) {
        result = k.allocate(8);
        k.u64(result, owned.rawVtable);
        handles.set(result, effect);
      } else result = 0;
    } else if (["detached", "bone", "afterimage"].includes(name)) {
      const descriptor = { kind: name };
      if (name === "bone") descriptor.resolvedBoneKey = dx >>> 0;
      else if (name === "detached") {
        descriptor.positionHex = hex(k.read(dx, 12));
        descriptor.matrixHex = hex(k.read(cx, 64));
      }
      const proxy = k.allocate(8);
      proxies.set(proxy, descriptor);
      k.u64(di, proxy);
      k.u64(di + 8, 0);
      result = di;
    } else if (name === "retain") {
      const effect = take(handles, dx),
        wrapper = k.allocate(8);
      k.u64(wrapper, owned.wrapperVtable);
      wrappers.set(wrapper, effect);
      k.u64(di, wrapper);
      k.u64(di + 8, 0);
      requests.push({ kind: "retain-effect-request", effect });
      result = di;
    } else if (name === "definition") {
      take(handles, di);
      result = a.systemDefinition;
    } else if (["scalar", "playSpeed"].includes(name))
      requests.push({
        kind: name + "-request",
        effect: take(handles, di),
        value: k.scalar(uc.X86_REG_XMM0),
      });
    else if (["source", "target"].includes(name))
      requests.push({
        kind: name + "-binding-request",
        effect: take(handles, di),
        binding: take(proxies, k.q(si)),
      });
    else if (name === "ownerBinding") {
      if (si !== a.actor) throw Error("Unowned owner-binding request");
      requests.push({
        kind: "owner-binding-request",
        effect: take(handles, di),
      });
    } else if (["stop", "release", "speedUpdate"].includes(name)) {
      const request = { kind: name + "-request", effect: take(wrappers, di) };
      if (name === "speedUpdate") request.value = k.scalar(uc.X86_REG_XMM0);
      requests.push(request);
    } else throw Error("Unknown animation attachment boundary");
    if (result !== undefined) e.reg_write_i64(uc.X86_REG_RAX, BigInt(result));
    k.ret();
  }
  for (const [index, name] of callbackNames.entries()) {
    const address = owned.callbackBase + index * 16;
    e.mem_write(address, new Uint8Array([0xc3]));
    e.hook_add(uc.HOOK_CODE, () => callback(name), null, address, address);
  }
  for (const [table, slots] of Object.entries({
    contextVtable: {
      0: "owner",
      64: "position",
      104: "create",
      112: "retain",
      120: "detached",
      128: "bone",
      136: "afterimage",
    },
    rawVtable: {
      0: "scalar",
      8: "playSpeed",
      16: "source",
      24: "target",
      32: "ownerBinding",
      56: "definition",
    },
    wrapperVtable: { 8: "release", 16: "stop", 40: "speedUpdate" },
  })) {
    e.mem_write(owned[table], new Uint8Array(0x100));
    for (const [offset, name] of Object.entries(slots))
      k.u64(
        owned[table] + Number(offset),
        owned.callbackBase + callbackNames.indexOf(name) * 16,
      );
  }
  function activate(value) {
    ensureOpen();
    validate(value);
    if (runtime !== null && !poisoned && k.readU32(runtime + 0x30) !== 0)
      throw Error("Cleanup required before another attachment activation");
    poisoned = true;
    initializeHeap();
    handles = new Map();
    wrappers = new Map();
    proxies = new Map();
    requests = [];
    createSucceeds = value.createSucceeds ?? true;
    for (const [address, size] of [
      [a.actor, 0x200],
      [a.context, 0x10],
      [owned.rig, 0x100],
      [owned.pose, 0x120],
    ])
      e.mem_write(address, new Uint8Array(size));
    e.mem_write(a.systemDefinition, defaultSystem);
    k.put(a.systemDefinition + 0xc7, [value.poseAfterimage ? 1 : 0], "u8");
    k.put(a.actor + 0x29, [value.suppressed ? 1 : 0], "u8");
    k.u64(a.actor + 0x38, owned.rig);
    k.u64(a.actor + 0xd0, owned.pose);
    k.u64(owned.pose + 0x70, owned.rig);
    k.u64(owned.pose + 8, owned.poses);
    k.put(owned.pose + 0x10, [value.joints.length], "u32");
    k.u64(owned.rig + 0x28, owned.joints);
    e.mem_write(owned.position, bytes(value.ownerPositionHex, 12));
    const bucket = k.allocate(8),
      sentinel = k.allocate(8),
      nodes = value.joints.map(() => k.allocate(0x18));
    k.u64(bucket, sentinel);
    k.u64(owned.rig + 0x48, bucket);
    k.u64(owned.rig + 0x50, 1);
    k.u64(sentinel, nodes[0] ?? 0);
    for (const [i, joint] of value.joints.entries()) {
      const node = nodes[i];
      k.u64(node, nodes[i + 1] ?? 0);
      k.u64(node + 8, joint.hash);
      k.put(node + 0x10, [joint.hash], "u32");
      // This row index is intentionally a supplied map input, not a recovered
      // implementation of the native rig constructor.
      e.mem_write(node + 0x14, new Uint8Array([i & 255, i >>> 8]));
      e.mem_write(owned.joints + i * 0x70, new Uint8Array(0x70));
      e.mem_write(owned.joints + i * 0x70, new Uint8Array([i & 255, i >>> 8]));
      k.put(owned.joints + i * 0x70 + 4, [joint.resolvedBoneKey], "u32");
      e.mem_write(owned.poses + i * 40, bytes(joint.transformHex, 40));
    }
    k.callNative(0x15dc290, { RDI: a.definition });
    k.put(
      a.definition + 0x18,
      [value.effectKey, value.secondaryKey ?? 0],
      "u32",
    );
    k.put(a.definition + 0x4a, [value.detachable ? 1 : 0], "u8");
    k.put(a.definition + 0x50, [value.effectScalar ?? 1]);
    const pairs = k.allocate(Math.max(8, value.pairs.length * 8));
    value.pairs.forEach((pair, i) => k.put(pairs + i * 8, pair, "u32"));
    k.u64(a.definition + 0x30, pairs);
    k.put(a.definition + 0x38, [value.pairs.length], "u32");
    k.u64(a.context, owned.contextVtable);
    k.u64(a.link + 8, a.context);
    k.put(a.point, [0], "u32");
    k.callNative(0x15c1750, { RDI: a.link, RSI: a.definition, RDX: a.point });
    runtime = Number(e.reg_read_i64(uc.X86_REG_RAX));
    try {
      k.callNative(meta.activationRva, { RDI: runtime });
      poisoned = false;
      return outputState();
    } catch (error) {
      poisoned = true;
      throw error;
    }
  }
  return {
    activate,
    cleanup() {
      ensureReady();
      requests = [];
      try {
        k.callNative(meta.cleanupRva, { RDI: runtime });
        return outputState();
      } catch (error) {
        poisoned = true;
        throw error;
      }
    },
    close() {
      if (!closed) {
        closed = true;
        handles.clear();
        wrappers.clear();
        proxies.clear();
        requests = [];
        k.close();
      }
    },
  };
}
