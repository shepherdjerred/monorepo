import {
  rotateByteLeft,
  swapAdjacentBits,
} from "./native-terrain-byte-codecs.mjs";

const pageSize = 0x1000;
const arena = 0x10000000;
const arenaSize = 0x100000;
const object = arena + 0x100;
const cursor = arena + 0x400;
const wire = arena + 0x1000;
const config = arena + 0x3000;
const grid = arena + 0x5000;
const stack = arena + 0xf008;
const heapStart = arena + 0x10000;
const archiveSha256 =
  "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7";
const mapBounds = [
  -1.1048965454101562, 32.75579833984375, 14718.400390625, 14792.2109375,
];
const placementLookups = [0x558830, 0x5564c0, 0x361090, 0x864870, 0x14a0240];
const placementEnd = 0x866394;
const view = (bytes) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const rotate = (byte, bits) => rotateByteLeft(byte & 255, bits);
const bytes = (...values) => Uint8Array.of(...values);

export const sennaGroundHitResourceKey = 0x6bb08197;
const keyVarint = bytes(0x02, 0x52, 0x55, 0x1b, 0xc7);

/** Match the canonical original wire varint for this Senna resource, which has no constructor preset. */
export function hasSennaGroundHitResourceKey(payload) {
  for (
    let offset = payload.indexOf(keyVarint[0]);
    offset !== -1;
    offset = payload.indexOf(keyVarint[0], offset + 1)
  ) {
    if (keyVarint.every((value, index) => payload[offset + index] === value))
      return true;
  }
  return false;
}

export async function createNativeRiftEffectCreateReader(
  uc,
  profile,
  imagePages,
  placementResourceKeys = [sennaGroundHitResourceKey],
) {
  const placementKeys = new Set(placementResourceKeys);
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", imagePages)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (
    profile.base !== 0x100000000 ||
    profile.archiveSha256 !== archiveSha256 ||
    profile.pageSha256 !== digest ||
    imagePages.byteLength !== profile.pages.length * pageSize ||
    profile.pages.some(
      (page, index) =>
        !Number.isSafeInteger(page) ||
        page < 0 ||
        page % pageSize !== 0 ||
        (index > 0 && page <= profile.pages[index - 1]),
    )
  )
    throw Error("Unsupported exact .8428 effect creation image");

  const machine = new uc.Unicorn(uc.ARCH_X86, uc.MODE_64);
  const base = profile.base;
  const empty = new Uint8Array(arenaSize);
  let heap = heapStart;
  let context = 0;
  const lookups = new Map();
  const register = (name) =>
    Number(machine.reg_read_i64(uc["X86_REG_" + name]));
  const set = (name, value) =>
    machine.reg_write_i64(uc["X86_REG_" + name], BigInt(value));
  const read = (address, length) =>
    new Uint8Array(machine.mem_read(address, length));
  const read64 = (address) =>
    Number(view(read(address, 8)).getBigUint64(0, true));
  const write64 = (address, value) => {
    const out = new Uint8Array(8);
    view(out).setBigUint64(0, BigInt(value), true);
    machine.mem_write(address, out);
  };
  const returnHost = (value) => {
    const sp = register("RSP");
    set("RAX", value);
    set("RIP", read64(sp));
    set("RSP", sp + 8);
  };
  function host(name) {
    const target = register("RDI");
    const source = register("RSI");
    switch (name) {
      case "context": {
        const out = new Uint8Array(4);
        view(out).setUint32(0, context, true);
        machine.mem_write(target + 12, out);
        returnHost(1);
        return;
      }
      case "allocate":
      case "_malloc": {
        if (
          !Number.isSafeInteger(target) ||
          target < 0 ||
          target > arena + arenaSize - heap
        )
          throw Error("Effect creation allocation exceeds arena");
        const allocated = heap;
        heap += Math.max(32, Math.ceil(target / 32) * 32);
        if (heap > arena + arenaSize)
          throw Error("Effect creation allocation exceeds arena");
        returnHost(allocated);
        return;
      }
      case "___cxa_guard_acquire":
        returnHost(read(target, 1)[0] === 0 ? 1 : 0);
        return;
      case "___cxa_guard_release":
        machine.mem_write(target, bytes(1));
        returnHost(0);
        return;
      case "___cxa_atexit":
      case "_pthread_mutex_lock":
      case "_pthread_mutex_unlock":
        returnHost(0);
        return;
      case "___bzero":
        if (!Number.isSafeInteger(source) || source < 0 || source > arenaSize)
          throw Error("Effect creation clear exceeds arena");
        machine.mem_write(target, empty.subarray(0, source));
        returnHost(target);
        return;
      case "_memcpy":
      case "_memmove": {
        const length = register("RDX");
        if (!Number.isSafeInteger(length) || length < 0 || length > arenaSize)
          throw Error("Effect creation copy exceeds arena");
        machine.mem_write(target, read(source, length));
        returnHost(target);
        return;
      }
      default:
        throw Error("Unowned archived effect creation call " + name);
    }
  }
  function hook(rva, callback) {
    if (profile.pages.includes(rva & ~(pageSize - 1)))
      machine.hook_add(uc.HOOK_CODE, callback, null, base + rva, base + rva);
  }
  function call(entry, registers, stop = arena) {
    set("RSP", stack);
    set("RBP", 0);
    write64(stack, arena);
    for (const [name, value] of Object.entries(registers)) set(name, value);
    machine.emu_start(base + entry, stop, 0, 1_000_000);
    if (register("RIP") !== stop)
      throw Error("Original effect creation reader stopped unexpectedly");
    return register("RAX");
  }
  function span(address, stride) {
    const allocation = view(read(address, 12));
    const pointer = Number(allocation.getBigUint64(0, true));
    const count = allocation.getUint32(8, true);
    if (
      count &&
      (!Number.isSafeInteger(pointer) ||
        pointer < heapStart ||
        pointer + count * stride > heap)
    )
      throw Error("Original effect creation span exceeds its allocation");
    return { pointer, count };
  }
  function placement(group, entry, handle, owner, resourceKey) {
    for (const [index, offset] of [0xbc, 0xc4, 0xdc, 0xe4].entries()) {
      const out = new Uint8Array(4);
      view(out).setFloat32(0, mapBounds[index], true);
      machine.mem_write(grid + offset, out);
    }
    call(0x16db78c, { R12: grid }, base + 0x16db7e9);
    lookups.clear();
    call(0x864be0, { RDI: group, RSI: entry, RDX: 0 }, base + placementEnd);
    const descriptor = view(read(register("RBP") - 0x198, 0xc0));
    if (
      lookups.get(0x864d10) !== handle ||
      lookups.get(0x864db1) !== owner ||
      descriptor.getUint32(8, true) !== resourceKey
    )
      throw Error(
        "Original effect creation lookup differs from its packet fields",
      );
    const positions = [0x54, 0x60, 0x6c].map((at) =>
      [0, 4, 8].map((offset) => descriptor.getFloat32(at + offset, true)),
    );
    const scaleRate = [0x78, 0x7c].map((offset) =>
      descriptor.getFloat32(offset, true),
    );
    if (![...positions.flat(), ...scaleRate].every(Number.isFinite))
      throw Error("Nonfinite original effect placement");
    return { flags: descriptor.getUint32(0x48, true), positions, scaleRate };
  }

  try {
    machine.mem_map(arena, arenaSize, uc.PROT_READ | uc.PROT_WRITE);
    for (const [index, page] of profile.pages.entries()) {
      machine.mem_map(base + page, pageSize, uc.PROT_ALL);
      machine.mem_write(
        base + page,
        imagePages.subarray(index * pageSize, (index + 1) * pageSize),
      );
    }
    for (const guard of profile.guard) write64(base + guard, arena + 0x2000);
    hook(0x1637cb0, () => host("context"));
    for (const rva of [0x14a0300, 0x14a2030, 0x14c5b20])
      hook(rva, () => host("allocate"));
    for (const [rva, name] of Object.entries(profile.imports))
      hook(Number(rva), () => host(name));
    for (const rva of placementLookups)
      hook(rva, () => {
        lookups.set(read64(register("RSP")) - base, register("RSI") >>> 0);
        returnHost(0);
      });
    hook(0x866458, () => {
      throw Error("Original effect chose a different placement path");
    });

    const table = read(base + 0x2141640, 256);
    const tables = {
      key: (byte) => swapAdjacentBits(rotate(rotate(0x5b - byte, 3) + 0xec, 4)),
      owner: (byte) => table[~rotate(rotate(byte + 0x20, 1) ^ 0x47, 4) & 255],
      handle: (byte) =>
        rotate(
          table[
            rotate(
              table[((swapAdjacentBits(byte) ^ 0xa0) + 0x43) & 255] ^ 0x25,
              6,
            )
          ],
          7,
        ),
      parent: (byte) =>
        (0xe0 - swapAdjacentBits((swapAdjacentBits(byte) + 0x3e) & 255)) & 255,
    };
    const field = (address, decode) =>
      view(read(address, 4).map(decode)).getUint32(0, true);
    return {
      close: () => machine.close(),
      decode(payload, envelopeContext) {
        if (
          !(payload instanceof Uint8Array) ||
          payload.length === 0 ||
          payload.length > config - wire ||
          envelopeContext !== envelopeContext >>> 0
        )
          throw Error("Invalid .8428 effect creation envelope");
        machine.mem_write(arena, empty.subarray(0, heap - arena));
        heap = heapStart;
        context = envelopeContext;
        write64(base + 0x24e8590, config);
        machine.mem_write(config + 8, bytes(4));
        machine.mem_write(config + 0x70, bytes(1));
        call(
          0x101276d,
          { RBX: object, RDI: 0, RSI: 0, RDX: 0 },
          base + 0x101c304,
        );
        const packet = read64(object);
        if (view(read(packet + 8, 2)).getUint16(0, true) !== 938)
          throw Error("Wrong original effect creation constructor");
        machine.mem_write(wire, payload);
        write64(cursor, wire);
        const accepted = call(0x1145c10, {
          RDI: packet,
          RSI: cursor,
          RDX: wire + payload.length,
        });
        if ((accepted & 255) !== 1 || read64(cursor) !== wire + payload.length)
          throw Error(
            "Original effect creation reader did not consume the entire body",
          );
        const groups = span(packet + 16, 80);
        return Array.from({ length: groups.count }, (_, index) => {
          const group = groups.pointer + index * 80;
          const resourceKey = field(group + 0x30, tables.key);
          const entries = span(group + 0x40, 192);
          return {
            resourceKey,
            entries: Array.from({ length: entries.count }, (_, entryIndex) => {
              const entry = entries.pointer + entryIndex * 192;
              const handle = field(entry + 0x98, tables.handle);
              const owner = field(entry + 0x70, tables.owner);
              const parent = field(entry + 0xa0, tables.parent);
              const descriptor =
                placementKeys.has(resourceKey) && parent === 0 && context === 0
                  ? placement(group, entry, handle, owner, resourceKey)
                  : null;
              return { handle, owner, parent, descriptor };
            }),
          };
        });
      },
    };
  } catch (error) {
    machine.close();
    throw error;
  }
}
