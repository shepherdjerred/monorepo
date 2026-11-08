import {
  createLatestVfxEmitter,
  emitterPreviewMath,
} from "./latest-vfx-emitter.mjs";
import { sha256 } from "./structural-comparison.mjs";

export { emitterPreviewMath as systemPreviewMath };

const initializers = [
  {
    startRva: 0x17608c4,
    endRva: 0x1760a6b,
    registers: { RBX: "system", R12: "resource", RBP: 0 },
  },
  {
    startRva: 0x1760aae,
    endRva: 0x1760ae1,
    registers: { RBX: "system", R13: "manager" },
  },
  { startRva: 0x1760b05, endRva: 0x1760b0e, registers: { RBX: "system" } },
  { startRva: 0x1745577, endRva: 0x1745581, registers: { RBX: "manager" } },
  { startRva: 0x1745693, endRva: 0x17456a3, registers: { RBX: "manager" } },
];

export async function createLatestVfxSystem(
  uc,
  profile,
  image,
  spawnBytes,
  graphBytes,
  emitterBytes,
  systemBytes,
  math,
) {
  if (
    !(
      systemBytes instanceof ArrayBuffer || systemBytes instanceof Uint8Array
    ) ||
    (await sha256(systemBytes)) !== profile.vfxSystemSha256
  )
    throw Error("Native system package hash mismatch");
  const metadata = JSON.parse(new TextDecoder().decode(systemBytes)),
    graphHash = await sha256(graphBytes);
  if (
    metadata.schema !== 1 ||
    metadata.build !== "16.21.829.8620" ||
    metadata.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== metadata.build ||
    profile.protocolDigest !== metadata.protocol ||
    metadata.decoderImageSha256 !== profile.decoderImageSha256 ||
    metadata.vfxEmitterSha256 !== profile.vfxEmitterSha256 ||
    metadata.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    metadata.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    metadata.tickRva !== 0x1763220 ||
    metadata.rootConstructorRva !== 0x1779b60 ||
    metadata.basisRva !== 0x1762430 ||
    metadata.nativeRootFlags !== 0xd4 ||
    metadata.nativeTickRate !== 30 ||
    metadata.nativeMaxSubsteps !== 20 ||
    JSON.stringify(metadata.initializers) !== JSON.stringify(initializers) ||
    metadata.actorListAddress !== 0x1002f000 ||
    metadata.positionInputAddress !== 0x1002f008 ||
    metadata.basisInputAddress !== 0x1002f018 ||
    metadata.nativeQualityMultipliersHex !==
      "0000803f0000803f0000803f0000803f0000803f00000000" ||
    !metadata.templates.some((reference) => reference.sha256 === graphHash)
  )
    throw Error("Unsupported native system contract");
  const emitter = await createLatestVfxEmitter(
    uc,
    profile,
    image,
    spawnBytes,
    graphBytes,
    emitterBytes,
    math,
  );
  return new ParticleSystem(emitter, metadata);
}

class ParticleSystem {
  #emitter;
  #checkpoints = new WeakMap();
  constructor(emitter, metadata) {
    this.#emitter = emitter;
    this.metadata = metadata;
    const k = emitter.kernel,
      e = k.engine,
      uc = k.uc;
    for (const end of new Set([
      ...initializers.map((block) => block.endRva),
      0x17567b7,
      0x174bbd5,
      0x174bc8d,
    ]))
      e.hook_add(
        uc.HOOK_CODE,
        () => {
          if (this.fragmentEnd === end) e.emu_stop();
        },
        null,
        k.base + end,
        k.base + end,
      );
    e.hook_add(
      uc.HOOK_CODE,
      () => {
        if (Number(e.reg_read_i64(uc.X86_REG_RDI)) !== k.a.actor)
          throw Error("Unadmitted sibling emitter");
        const bytes = k.read(k.a.system + 0x108, 12),
          view = new DataView(bytes.buffer);
        this.substeps.push({
          time: k.scalar(uc.X86_REG_XMM0),
          position: [0, 1, 2].map((i) => view.getFloat32(i * 4, true)),
        });
      },
      null,
      k.base + 0x1757f10,
      k.base + 0x1757f10,
    );
    this.substeps = [];
  }
  reset(seed, smoothingQuality, creation) {
    if (
      this.closed ||
      !creation ||
      !finite(creation.createdAt) ||
      !vector(creation.position)
    )
      throw Error("Invalid particle-system creation input");
    const parent = this.#emitter,
      k = parent.kernel,
      a = k.a,
      m = this.metadata;
    parent.reset(seed, smoothingQuality);
    k.callNative(m.rootConstructorRva, { RDI: a.systemDefinition });
    for (const block of initializers) {
      const registers = Object.fromEntries(
        Object.entries(block.registers).map(([name, value]) => [
          name,
          name === "RBP"
            ? a.stack - 0x100
            : typeof value === "string"
              ? a[value]
              : value,
        ]),
      );
      this.#fragment(block.startRva, registers, block.endRva);
    }
    k.engine.mem_write(a.manager + 0x284, unhex(m.nativeQualityMultipliersHex));
    this.#fragment(0x17567a6, { RDI: a.actor }, 0x17567b7);
    k.u64(a.system + 0x30, a.manager);
    k.u64(a.system + 0x40, m.actorListAddress);
    k.put(a.system + 0x48, [1, 1], "u32");
    k.u64(m.actorListAddress, a.actor);
    k.put(m.basisInputAddress, [0, 1, 0]);
    k.callNative(m.basisRva, { RDI: a.system, RSI: m.basisInputAddress });
    this.#fragment(0x174bbb3, { RBX: a.system }, 0x174bbd5, {
      XMM0: creation.createdAt,
    });
    k.put(m.positionInputAddress, creation.position);
    this.#fragment(
      0x174bc15,
      { RBX: a.system, RCX: m.positionInputAddress, RAX: a.resource },
      0x174bc8d,
    );
    this.lastTime = Math.fround(creation.createdAt);
    this.substeps = [];
    this.ready = true;
  }
  #fragment(start, registers, end, scalars = {}) {
    this.fragmentEnd = end;
    try {
      this.#emitter.kernel.callNative(start, registers, end, scalars);
    } finally {
      this.fragmentEnd = null;
    }
  }
  tick(input) {
    const parent = this.#emitter,
      k = parent.kernel,
      a = k.a;
    if (
      !this.ready ||
      this.closed ||
      !finite(input.time) ||
      input.time < this.lastTime ||
      !vector(input.current) ||
      !vector(input.viewForward) ||
      Math.hypot(...input.viewForward) < 0.0001 ||
      !Number.isInteger(input.maxSubsteps) ||
      input.maxSubsteps < 1 ||
      input.maxSubsteps > 20
    )
      throw Error("Invalid particle-system tick input");
    const createdAt = new DataView(
      k.read(a.system + 0x12c, 4).buffer,
    ).getFloat32(0, true);
    if (input.time - createdAt > 30)
      throw Error("Unprepared particle-system clock span");
    this.lastTime = input.time;
    this.substeps = [];
    k.births = [];
    k.mathCalls = [];
    k.services = {};
    k.put(a.system + 0x108, input.current);
    k.engine.mem_write(a.stack - 0x8000, new Uint8Array(0x8000));
    k.callNative(
      this.metadata.tickRva,
      { RDI: a.system, RSI: input.maxSubsteps },
      null,
      { XMM0: input.time },
    );
    const state = k.snapshot();
    state.systemHex = hex(k.read(a.system, 0x2b8));
    return {
      state,
      substeps: this.substeps,
      geometry: this.render(input.viewForward),
    };
  }
  render(viewForward) {
    if (!this.ready || this.closed)
      throw Error("Particle system is not initialized");
    return this.#emitter.renderGeometry(viewForward);
  }
  checkpoint() {
    if (!this.ready || this.closed)
      throw Error("Particle system must be initialized before checkpointing");
    const parent = this.#emitter.checkpoint(),
      handle = Object.freeze({ time: this.lastTime, bytes: parent.bytes });
    this.#checkpoints.set(handle, { parent, time: this.lastTime });
    return handle;
  }
  inspectState() {
    if (!this.ready || this.closed)
      throw Error("Particle system is not initialized");
    const parent = this.#emitter,
      k = parent.kernel,
      layout = parent.metadata.checkpointLayout;
    return {
      context: k.read(layout.ownedAddress, layout.ownedBytes),
      arena: k.read(layout.heapAddress, k.nextHeap - layout.heapAddress),
      globals: layout.globals.map((value) =>
        k.read(k.base + value.rva, value.bytes),
      ),
      allocations: [...k.allocations].sort(([a], [b]) => a - b),
      nextHeap: k.nextHeap,
    };
  }
  restore(handle) {
    const saved = this.#checkpoints.get(handle);
    if (this.closed || !saved)
      throw Error("Unknown, released or foreign particle-system checkpoint");
    this.#emitter.restore(saved.parent);
    this.lastTime = saved.time;
    this.substeps = [];
    this.ready = true;
  }
  releaseCheckpoint(handle) {
    const saved = this.#checkpoints.get(handle);
    if (this.closed || !saved)
      throw Error("Unknown, released or foreign particle-system checkpoint");
    this.#emitter.releaseCheckpoint(saved.parent);
    this.#checkpoints.delete(handle);
  }
  close() {
    if (!this.closed) this.#emitter.close();
    this.closed = true;
    this.ready = false;
    this.#checkpoints = new WeakMap();
  }
}
const finite = (value) =>
    Number.isFinite(value) && Number.isFinite(Math.fround(value)),
  vector = (value) =>
    Array.isArray(value) && value.length === 3 && value.every(finite),
  hex = (bytes) =>
    Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(""),
  unhex = (value) =>
    Uint8Array.from(value.match(/../g) ?? [], (item) => parseInt(item, 16));
