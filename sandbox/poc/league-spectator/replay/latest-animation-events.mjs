import { NativeVfxSpawnKernel, spawnPreviewMath } from "./latest-vfx-spawn.mjs";
import { sha256 } from "./structural-comparison.mjs";

// This component observes requests at the original particle-event boundary.
// A request does not create/release particles. Replay clocks, bone attachment,
// interrupt/loop policy and actual presentation require separate admission.
const manager = 0x1002c000,
  context = 0x10026000,
  token = 0x10024000,
  heapStart = 0x10400000,
  boundaries = [
    { rva: 0x1594d20, kind: "activate-request" },
    { rva: 0x1595510, kind: "release-request" },
    { rva: 0x1594cc0, kind: "play-speed-request" },
  ],
  blocks = [
    [0x15dc290, 0x15dc2ed],
    [0x15c1750, 0x15c17c5],
    [0x1589270, 0x1589e90],
    [0x158cff0, 0x158d600],
  ],
  finite = (v) => typeof v === "number" && Number.isFinite(Math.fround(v));

function checkedSpecs(specs) {
  const keys = new Set([
    "id",
    "startFrame",
    "endFrame",
    "skipExpired",
    "isLoop",
    "isKillEvent",
    "fireIfEarly",
  ]);
  if (!Array.isArray(specs) || specs.length > 1024)
    throw Error("Invalid animation event collection");
  const ids = new Set();
  return specs.map((event) => {
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      Object.keys(event).some((k) => !keys.has(k)) ||
      typeof event.id !== "string" ||
      !event.id ||
      ids.has(event.id)
    )
      throw Error("Invalid animation scheduling identity or field");
    ids.add(event.id);
    const normalized = {
      startFrame: 0,
      endFrame: -1,
      skipExpired: false,
      isLoop: true,
      isKillEvent: true,
      fireIfEarly: false,
      ...event,
    };
    if (
      !["startFrame", "endFrame"].every((k) => finite(normalized[k])) ||
      !["skipExpired", "isLoop", "isKillEvent", "fireIfEarly"].every(
        (k) => typeof normalized[k] === "boolean",
      )
    )
      throw Error("Invalid animation scheduling value");
    normalized.startFrame = Math.fround(normalized.startFrame);
    normalized.endFrame = Math.fround(normalized.endFrame);
    return normalized;
  });
}

export async function createLatestAnimationEvents(
  uc,
  profile,
  image,
  spawnBytes,
  definitionBytes,
) {
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(definitionBytes)) !== profile.animationEventsSha256
  )
    throw Error("Animation event package hash mismatch");
  const meta = JSON.parse(new TextDecoder().decode(definitionBytes)),
    spawn = JSON.parse(new TextDecoder().decode(spawnBytes));
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
    meta.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    spawn.runtimeSha256 !== meta.runtimeSha256 ||
    spawn.build !== meta.build ||
    spawn.protocol !== meta.protocol ||
    meta.constructorRva !== 0x15dc290 ||
    meta.factoryRva !== 0x15c1750 ||
    meta.dispatchRva !== 0x1589270 ||
    meta.resyncRva !== 0x158cff0 ||
    meta.runtimeVtableRva !== 0x23e31b8 ||
    JSON.stringify(meta.requestBoundaries) !== JSON.stringify(boundaries) ||
    JSON.stringify(meta.sourceBlocks?.map((b) => [b.startRva, b.endRva])) !==
      JSON.stringify(blocks)
  )
    throw Error("Unsupported animation event source");
  const imageBytes =
    image instanceof Uint8Array ? image : new Uint8Array(image);
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(imageBytes.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Animation scheduling code changed");
  const kernel = new NativeVfxSpawnKernel(
      uc,
      profile,
      imageBytes,
      spawn,
      null,
      spawnPreviewMath,
    ),
    checkpoints = new WeakMap();
  let specs = null,
    runtimes = [],
    indices = new Map(),
    requests = [],
    lastFrame = null,
    generation = {},
    closed = false,
    poisoned = false;
  const ensureOpen = () => {
    if (closed) throw Error("Closed animation scheduler");
  };
  const ensureReady = () => {
    ensureOpen();
    if (!specs || poisoned) throw Error("Animation scheduler requires reset");
  };
  for (const boundary of boundaries)
    kernel.engine.hook_add(
      uc.HOOK_CODE,
      () => {
        const runtime = Number(kernel.engine.reg_read_i64(uc.X86_REG_RDI)),
          index = indices.get(runtime);
        if (index === undefined)
          throw Error("Animation request from unowned event");
        const request = { event: specs[index].id, kind: boundary.kind };
        if (boundary.kind === "play-speed-request")
          request.value = kernel.scalar(uc.X86_REG_XMM0);
        requests.push(request);
        // The boundary is deliberately external; original effect creation and
        // attachment code is not replaced with a claimed particle simulation.
        kernel.ret();
      },
      null,
      profile.imageBase + boundary.rva,
      profile.imageBase + boundary.rva,
    );

  function load(events) {
    ensureOpen();
    const normalized = checkedSpecs(events);
    specs = normalized;
    generation = {};
    return reset();
  }
  function reset() {
    ensureOpen();
    if (!specs) throw Error("No animation events loaded");
    poisoned = true;
    kernel.nextHeap = heapStart;
    kernel.allocations = new Map();
    kernel.services = {};
    kernel.mathCalls = [];
    kernel.births = [];
    kernel.engine.mem_write(manager, new Uint8Array(0x50));
    kernel.engine.mem_write(context, new Uint8Array(0x10));
    kernel.put(token, [0], "u32");
    runtimes = [];
    indices = new Map();
    requests = [];
    lastFrame = null;
    for (const [index, event] of specs.entries()) {
      const data = kernel.allocate(0x58);
      kernel.callNative(meta.constructorRva, { RDI: data });
      kernel.put(data + 0xc, [event.startFrame, event.endFrame]);
      for (const [offset, key] of [
        [9, "fireIfEarly"],
        [0x48, "isLoop"],
        [0x49, "isKillEvent"],
        [0x4c, "skipExpired"],
      ])
        kernel.put(data + offset, [event[key] ? 1 : 0], "u8");
      kernel.callNative(meta.factoryRva, {
        RDI: context,
        RSI: data,
        RDX: token,
      });
      const runtime = Number(kernel.engine.reg_read_i64(uc.X86_REG_RAX));
      if (kernel.q(runtime) !== profile.imageBase + meta.runtimeVtableRva)
        throw Error("Unexpected animation event runtime class");
      runtimes.push(runtime);
      indices.set(runtime, index);
    }
    const vector = kernel.allocate(Math.max(8, specs.length * 8));
    runtimes.forEach((runtime, i) => kernel.u64(vector + i * 8, runtime));
    kernel.u64(manager + 0x20, vector);
    kernel.put(manager + 0x28, [specs.length], "u32");
    poisoned = false;
  }
  function step(frame, resync = false) {
    ensureReady();
    if (!finite(frame) || typeof resync !== "boolean")
      throw Error("Invalid animation event clock");
    frame = Math.fround(frame);
    if (!resync && lastFrame !== null && frame < lastFrame)
      throw Error("Backward clock requires explicit resynchronization");
    requests = [];
    try {
      kernel.callNative(
        meta.dispatchRva,
        { RDI: manager, RSI: context, RDX: resync ? 1 : 0 },
        null,
        { XMM0: frame },
      );
      lastFrame = frame;
      return {
        requests: requests.map((r) => ({ ...r })),
        states: runtimes.map((runtime, i) => {
          const raw = kernel.read(runtime + 0x10, 12);
          return {
            event: specs[i].id,
            oneShot: !!raw[0],
            pending: !!raw[1],
            active: !!raw[2],
            phase: new DataView(raw.buffer).getUint32(4, true),
          };
        }),
      };
    } catch (error) {
      poisoned = true;
      throw error;
    }
  }
  function checkpoint() {
    ensureReady();
    const handle = Object.freeze({});
    checkpoints.set(handle, {
      generation,
      lastFrame,
      heap: kernel.read(heapStart, kernel.nextHeap - heapStart),
      manager: kernel.read(manager, 0x50),
      nextHeap: kernel.nextHeap,
      allocations: new Map(kernel.allocations),
    });
    return handle;
  }
  function restore(handle) {
    ensureReady();
    const snapshot = checkpoints.get(handle);
    if (!snapshot || snapshot.generation !== generation)
      throw Error("Unowned or stale animation checkpoint");
    kernel.engine.mem_write(heapStart, snapshot.heap);
    kernel.engine.mem_write(manager, snapshot.manager);
    kernel.nextHeap = snapshot.nextHeap;
    kernel.allocations = new Map(snapshot.allocations);
    lastFrame = snapshot.lastFrame;
    requests = [];
  }
  return {
    load,
    reset,
    step,
    checkpoint,
    restore,
    releaseCheckpoint(handle) {
      ensureOpen();
      if (!checkpoints.delete(handle))
        throw Error("Unowned or released animation checkpoint");
    },
    close() {
      if (!closed) {
        closed = true;
        specs = null;
        indices.clear();
        runtimes = [];
        kernel.close();
      }
    },
  };
}
