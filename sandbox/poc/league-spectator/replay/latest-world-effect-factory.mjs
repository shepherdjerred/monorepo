// Original world helper over one explicit prepared definition. Replay unit
// stacks, descriptor finalization and attachment providers are not inferred.
import { sha256 } from "./structural-comparison.mjs";
import { synchronizeParentPlacement } from "./latest-parent-placement.mjs";
const sessions = new WeakSet(),
  hex = (b) => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
export async function createLatestWorldEffectFactory({
  runtime,
  effectsManifestBytes,
}) {
  runtime.check();
  const k = runtime.kernel,
    abi = k.worldABI;
  if (
    !abi ||
    !abi.supportedRoots.includes(runtime.cache.effectId) ||
    sessions.has(runtime) ||
    (await sha256(effectsManifestBytes)) !== abi.effectsManifestSha256
  )
    throw Error(
      "A matching initialized parent root and unused world factory ABI are required",
    );
  const effects = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(effectsManifestBytes),
    ),
    definition = effects.definitions[runtime.cache.effectId],
    actor = definition && effects.actors[definition.actor];
  if (
    !actor ||
    effects.build !== abi.build ||
    effects.protocol !== abi.protocol
  )
    throw Error("World helper prepared root/manifest identity differs");
  sessions.add(runtime);
  const world = k.allocate(0x168),
    config = k.allocate(0x60);
  k.callNative(abi.entries.worldManager, { RDI: world });
  k.callNative(abi.entries.wrapperRegistration, {});
  k.callNative(abi.entries.wrapperConfig, { RDI: config });
  if (
    k.q(k.base + abi.globals.worldManager) !== world ||
    k.q(k.base + abi.globals.wrapperConfig) !== config
  )
    throw Error("Original world helper singleton publication differs");
  const initial = {
    world,
    config,
    worldHex: hex(k.read(world, 0x168)),
    configHex: hex(k.read(config, 0x60)),
  };
  return Object.freeze({
    initial: Object.freeze(initial),
    scope: abi.scope,
    create({ resourceKey, position, seed, clock }) {
      runtime.check();
      if (
        !Number.isInteger(resourceKey) ||
        resourceKey <= 0 ||
        resourceKey > 0xffffffff ||
        !Array.isArray(position) ||
        position.length !== 3 ||
        !position.every(
          (v) => Number.isFinite(v) && Number.isFinite(Math.fround(v)),
        ) ||
        typeof seed !== "bigint" ||
        seed < 0n ||
        seed > 0xffffffffffffffffn ||
        actor.resources[resourceKey.toString(16).padStart(8, "0")]?.effectId !==
          runtime.cache.effectId
      )
        throw Error(
          "Explicit authored key, finite world position and unsigned seed required",
        );
      runtime.supplyClock(clock);
      k.callNative(0x14910e0, { RDI: seed });
      const resolver = k.allocate(24),
        table = k.allocate(16),
        a = abi.inputs;
      k.callNative(abi.entries.resolverConstructor, { RDI: resolver });
      k.put(table, [resourceKey, 0], "u32");
      k.u64(table + 8, k.a.definition);
      k.u64(resolver + 8, table);
      k.put(resolver + 16, [1, 1], "u32");
      k.engine.mem_write(a.vectors, new Uint8Array(0x40));
      k.u64(a.auxiliaries, resolver);
      for (const [offset, value] of [
        [0x20, a.auxiliaries],
        [0x28, a.auxiliaries + 8],
        [0x30, a.auxiliaries + 8],
      ])
        k.u64(a.vectors + offset, value);
      k.put(a.position, position, "f32");
      k.engine.mem_write(a.output, new Uint8Array(16));
      k.callNative(abi.entries.helper, {
        RDI: a.output,
        RSI: resourceKey,
        RDX: a.vectors,
        RCX: a.vectors + 0x20,
        R8: 0,
        R9: a.position,
      });
      const shared = k.q(a.output),
        control = k.q(a.output + 8);
      if (
        k.allocations.get(shared) !== 8 ||
        k.allocations.get(control) !== 0x20
      )
        throw Error("World helper returned another shared pointer type");
      const wrapper = k.q(shared),
        object = k.q(wrapper + 0x178);
      if (
        k.allocations.get(wrapper) !== 0x268 ||
        k.allocations.get(object) !== 0x238 ||
        k.q(object + 0x48) !== k.a.definition
      )
        throw Error(
          "World wrapper did not bind the selected prepared definition",
        );
      const created = {
        resolver,
        table,
        shared,
        control,
        wrapper,
        object,
        position: [...position],
        resourceKey,
        wrapperHex: hex(k.read(wrapper, 0x268)),
        objectHex: hex(k.read(object, 0x238)),
        worldHex: hex(k.read(world, 0x168)),
      };
      k.callNative(abi.entries.activate, { RDI: object });
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
