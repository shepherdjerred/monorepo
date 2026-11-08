// Complete original factory over explicit detached descriptors. This API does
// not convert a decoded request with unresolved entity IDs into a detached one.
import { createLatestWorldEffectFactory } from "./latest-world-effect-factory.mjs";
import { synchronizeParentPlacement } from "./latest-parent-placement.mjs";
const hex = (b) =>
    Array.from(b, (v) => v.toString(16).padStart(2, "0")).join(""),
  finite = (v) =>
    typeof v === "number" &&
    Number.isFinite(v) &&
    Number.isFinite(Math.fround(v));
export async function createLatestWorldDescriptorFactory({
  runtime,
  effectsManifestBytes,
}) {
  runtime.check();
  const k = runtime.kernel,
    abi = k.descriptorABI;
  if (!abi || !abi.supportedRoots.includes(runtime.cache.effectId))
    throw Error("A matching detached descriptor factory extension is required");
  const world = await createLatestWorldEffectFactory({
      runtime,
      effectsManifestBytes,
    }),
    effects = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(effectsManifestBytes),
    ),
    actor = effects.actors[effects.definitions[runtime.cache.effectId].actor],
    visibility = k.allocate(0x1c0);
  k.callNative(abi.entries.visibility, { RDI: visibility });
  if (k.q(k.base + abi.globals.visibility) !== visibility)
    throw Error("Original visibility configuration was not published");
  const initial = Object.freeze({
    ...world.initial,
    visibility,
    visibilityHex: hex(k.read(visibility, 0x1c0)),
  });
  function originalString(address, value) {
    if (
      typeof value !== "string" ||
      !value.length ||
      value.length > 1024 ||
      /[^\x01-\x7f]/.test(value)
    )
      throw Error("A bounded ASCII character context is required");
    k.engine.mem_write(
      abi.context.text,
      new TextEncoder().encode(value + "\0"),
    );
    k.engine.mem_write(address, new Uint8Array(24));
    k.callNative(abi.entries.string, {
      RDI: address,
      RSI: abi.context.text,
      RDX: value.length,
    });
  }
  function characterContext() {
    const c = abi.context,
      name = actor.character,
      skinId = actor.skinId;
    originalString(c.strings, name);
    originalString(c.strings + 0x20, "characters");
    const object = k.allocate(0x90);
    k.callNative(
      c.constructor[0],
      {
        RDI: object,
        RSI: c.strings,
        RDX: skinId,
        RCX: c.strings + 0x20,
        R8: 0,
      },
      c.constructor[1],
    );
    const decimalAscii = String(skinId);
    k.engine.mem_write(c.text, new TextEncoder().encode(decimalAscii + "\0"));
    k.engine.mem_write(c.frame - 0x300, new Uint8Array(0x300));
    k.u64(c.frame - 0x260, c.text);
    k.callNative(c.identity[0], { RBP: c.frame, RBX: object }, c.identity[1]);
    const identity = new DataView(k.read(object + 0x48, 4).buffer).getUint32(
      0,
      true,
    );
    return {
      name,
      skinId,
      namespace: "characters",
      identity,
      object,
      objectHex: hex(k.read(object, 0x90)),
      decimalAscii,
    };
  }
  return Object.freeze({
    initial,
    scope: abi.scope,
    create({ resourceKey, position, scale, rate, flags, seed, clock }) {
      runtime.check();
      if (
        !Number.isInteger(resourceKey) ||
        resourceKey <= 0 ||
        resourceKey > 0xffffffff ||
        actor.resources[resourceKey.toString(16).padStart(8, "0")]?.effectId !==
          runtime.cache.effectId ||
        !Array.isArray(position) ||
        position.length !== 3 ||
        !position.every(finite) ||
        !finite(scale) ||
        Math.fround(scale) <= 0 ||
        !finite(rate) ||
        Math.fround(rate) <= 0 ||
        !Number.isInteger(flags) ||
        flags < 0 ||
        flags > 0xffffffff ||
        (flags & ~0xb0) !== 0 ||
        typeof seed !== "bigint" ||
        seed < 0n ||
        seed > 0xffffffffffffffffn
      )
        throw Error(
          "Explicit detached descriptor key, pose, scalars, flags and seed required",
        );
      runtime.supplyClock(clock);
      k.callNative(0x14910e0, { RDI: seed });
      const context = characterContext(),
        resolver = k.allocate(24),
        table = k.allocate(16),
        a = abi.inputs;
      k.callNative(k.worldABI.entries.resolverConstructor, { RDI: resolver });
      k.put(table, [resourceKey, 0], "u32");
      k.u64(table + 8, k.a.definition);
      k.u64(resolver + 8, table);
      k.put(resolver + 16, [1, 1], "u32");
      k.u64(context.object + 0x60, resolver);
      k.engine.mem_write(a.descriptor, new Uint8Array(0xc0));
      k.put(a.descriptor + 8, [resourceKey], "u32");
      k.u64(a.auxiliaries, context.object);
      for (const [offset, value] of [
        [0x30, a.auxiliaries],
        [0x38, a.auxiliaries + 8],
        [0x40, a.auxiliaries + 8],
      ])
        k.u64(a.descriptor + offset, value);
      k.put(a.descriptor + 0x48, [flags], "u32");
      k.put(a.descriptor + 0x54, position, "f32");
      k.put(a.descriptor + 0x78, [scale, rate], "f32");
      k.engine.mem_write(a.output, new Uint8Array(16));
      const descriptorHex = hex(k.read(a.descriptor, 0xc0)),
        callsStart = k.hostCalls.length;
      k.callNative(abi.entries.factory, { RDI: a.output, RSI: a.descriptor });
      const shared = k.q(a.output),
        control = k.q(a.output + 8);
      if (
        k.allocations.get(shared) !== 8 ||
        k.allocations.get(control) !== 0x20
      )
        throw Error(
          "Original descriptor factory did not return its owned shared pointer",
        );
      const wrapper = k.q(shared),
        object = k.q(wrapper + 0x178);
      if (
        k.allocations.get(wrapper) !== 0x268 ||
        k.allocations.get(object) !== 0x238 ||
        k.q(object + 0x48) !== k.a.definition
      )
        throw Error(
          "Original descriptor factory created an unexpected wrapper/definition",
        );
      const created = {
        context,
        resolver,
        table,
        descriptorHex,
        finalDescriptorHex: hex(k.read(a.descriptor, 0xc0)),
        shared,
        control,
        wrapper,
        object,
        wrapperHex: hex(k.read(wrapper, 0x268)),
        objectHex: hex(k.read(object, 0x238)),
        controlHex: hex(k.read(control, 0x20)),
        worldHex: hex(k.read(initial.world, 0x168)),
        sharedCalls: k.hostCalls
          .slice(callsStart)
          .filter((c) =>
            [
              abi.sharedImports.lock.symbol,
              abi.sharedImports.releaseWeak.symbol,
            ].includes(c.name),
          ),
      };
      k.callNative(k.worldABI.entries.activate, { RDI: object });
      const parent = runtime.adoptActivatedObject(object),
        synchronization = synchronizeParentPlacement(k, object);
      return Object.freeze({
        ...created,
        parent,
        ownership: runtime.ownership(parent),
        synchronization,
        activatedWrapperHex: hex(k.read(wrapper, 0x268)),
        initialState: runtime.state(parent),
      });
    },
  });
}
