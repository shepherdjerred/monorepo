const archiveSha256 =
  "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7";
const pageSize = 4096;
const arena = 0x10000000;
const arenaSize = 0x100000;
const arenaEnd = arena + arenaSize;
const object = arena + 0x100;
const cursor = arena + 0x400;
const body = arena + 0x1000;
const guard = arena + 0x2000;
const emptyPool = arena + 0x3000;
const descriptor = arena + 0x4000;
const frame = arena + 0x6500;
const stack = arena + 0xf008;
const heapStart = arena + 0x10000;
const view = (bytes) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const maokaiRMissileSpellKey = 0x0187cc63;

/** Read only the reviewed .8428 opcode 639 Maokai R launch branch. */
export async function createNativeRiftMissileLaunchReader(uc, profile, pages) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", pages));
  const digest = Array.from(hash, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (
    profile.base !== 0x100000000 ||
    profile.archiveSha256 !== archiveSha256 ||
    profile.pageSha256 !== digest ||
    pages.length !== profile.pages.length * pageSize ||
    profile.pages.some(
      (page, index) =>
        !Number.isSafeInteger(page) ||
        page < 0 ||
        page % pageSize !== 0 ||
        (index > 0 && page <= profile.pages[index - 1]),
    )
  )
    throw Error("Unsupported exact .8428 missile launch image");
  const { base } = profile;
  const pageSet = new Set(profile.pages);
  const machine = new uc.Unicorn(uc.ARCH_X86, uc.MODE_64);
  const empty = new Uint8Array(arenaSize);
  const sourceNames = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  });
  const names = [];
  const owners = [];
  const spellKeys = [];
  let heap = heapStart;
  let context;
  let unresolved;
  const get = (name) => Number(machine.reg_read_i64(uc["X86_REG_" + name]));
  const set = (name, value) =>
    machine.reg_write_i64(uc["X86_REG_" + name], BigInt(value));
  const read = (address, length) =>
    new Uint8Array(machine.mem_read(address, length));
  const write = (address, bytes) => machine.mem_write(address, bytes);
  function writeInteger(address, value, width) {
    const bytes = new Uint8Array(width);
    if (width === 4) view(bytes).setUint32(0, value, true);
    else view(bytes).setBigUint64(0, BigInt(value), true);
    write(address, bytes);
  }
  const readPointer = (address) =>
    Number(view(read(address, 8)).getBigUint64(0, true));
  function hostReturn(value) {
    const sp = get("RSP");
    set("RAX", value);
    set("RIP", readPointer(sp));
    set("RSP", sp + 8);
  }
  function hook(rva, callback) {
    if (pageSet.has(rva & ~(pageSize - 1)))
      machine.hook_add(uc.HOOK_CODE, callback, null, base + rva, base + rva);
  }
  function host(name) {
    const first = get("RDI");
    const second = get("RSI");
    switch (name) {
      case "context":
        writeInteger(first + 12, context, 4);
        return hostReturn(1);
      case "allocate":
      case "_malloc": {
        const allocated = heap;
        heap += Math.max(32, Math.ceil(first / 32) * 32);
        if (!Number.isSafeInteger(first) || first < 0 || heap > arenaEnd)
          throw Error("Missile launch allocation exceeds arena");
        return hostReturn(allocated);
      }
      case "sourceName": {
        const data = read(second, 23);
        const length = data.indexOf(0);
        if (length < 0)
          throw Error("Missile launch source string exceeds inline storage");
        const name = data.subarray(0, length);
        if (name.some((byte) => byte > 127))
          throw Error("Missile launch source identifier must be ASCII");
        names.push(sourceNames.decode(name));
        const storage = new Uint8Array(24);
        storage[0] = length * 2;
        storage.set(name, 1);
        write(first, storage);
        return hostReturn(first);
      }
      case "owner":
        owners.push(get("ESI"));
        return hostReturn(0);
      case "spell":
        spellKeys.push(get("ESI"));
        return hostReturn(0);
      case "emptyPool":
        return hostReturn(emptyPool);
      case "___cxa_guard_acquire":
        return hostReturn(read(first, 1)[0] === 0 ? 1 : 0);
      case "___cxa_guard_release":
        write(first, Uint8Array.of(1));
        return hostReturn(0);
      case "___cxa_atexit":
      case "_pthread_mutex_lock":
      case "_pthread_mutex_unlock":
      case "neutral":
        return hostReturn(0);
      case "___bzero":
        if (first < arena || second < 0 || first + second > arenaEnd)
          throw Error("Missile launch clear exceeds arena");
        write(first, empty.subarray(0, second));
        return hostReturn(first);
      default:
        throw Error("Unowned archived missile launch call " + name);
    }
  }
  function call(entry, registers = {}, end = arena) {
    writeInteger(stack, arena, 8);
    for (const name of ["RDI", "RSI", "RDX", "RCX", "RBP"])
      set(name, registers[name] ?? 0);
    set("RSP", stack);
    for (const [name, value] of Object.entries(registers)) set(name, value);
    machine.emu_start(base + entry, end, 0, 400_000);
    if (get("RIP") !== end && !unresolved)
      throw Error("Original missile launch reader stopped unexpectedly");
  }
  try {
    machine.mem_map(arena, arenaSize, uc.PROT_READ | uc.PROT_WRITE);
    for (const [index, offset] of profile.pages.entries()) {
      machine.mem_map(base + offset, pageSize, uc.PROT_ALL);
      write(
        base + offset,
        pages.subarray(index * pageSize, (index + 1) * pageSize),
      );
    }
    for (const rva of profile.guard) writeInteger(base + rva, guard, 8);
    for (const [rva, symbol] of Object.entries(profile.imports)) {
      const name =
        symbol ===
        "__ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6assignEPKc"
          ? "sourceName"
          : symbol;
      hook(Number(rva), () => host(name));
    }
    for (const [rva, name] of [
      [0x1637cb0, "context"],
      [0x14a0300, "allocate"],
      [0x14a2030, "allocate"],
      [0x14c5b20, "allocate"],
      [0x14a0240, "neutral"],
      [0x5564c0, "owner"],
      [0x558890, "owner"],
      [0x863d80, "spell"],
      [0x874a60, "emptyPool"],
    ])
      hook(rva, () => host(name));
    hook(0x557b67, () => {
      unresolved = true;
      machine.emu_stop();
    });
    return {
      close: () => machine.close(),
      decode(payload, packetContext) {
        if (
          !(payload instanceof Uint8Array) ||
          payload.length < 1 ||
          payload.length > 1024 ||
          packetContext >>> 0 !== packetContext
        )
          throw Error("Invalid missile launch envelope");
        context = packetContext;
        unresolved = false;
        heap = heapStart;
        names.length = owners.length = spellKeys.length = 0;
        write(arena, empty);
        call(0x108f060, { RDI: object });
        writeInteger(cursor, body, 8);
        write(body, payload);
        call(0x1321380, {
          RDI: object,
          RSI: cursor,
          RDX: body + payload.length,
        });
        if (
          (get("RAX") & 255) !== 1 ||
          readPointer(cursor) !== body + payload.length
        )
          throw Error("Original missile launch reader rejected packet body");
        call(0x845240, { RDI: descriptor });
        call(0x842310, { RDI: descriptor, RSI: object + 0x58 });
        if (
          unresolved ||
          !names.includes("Maokai") ||
          !spellKeys.includes(maokaiRMissileSpellKey)
        )
          return null;
        if (
          owners.length !== 2 ||
          owners[0] !== owners[1] ||
          names.length !== 1 ||
          spellKeys.length !== 1
        )
          throw Error("Ambiguous original missile launch identity");
        const raw = view(read(descriptor, 0x190));
        const entity = raw.getUint32(0x9c, true);
        if (entity !== context)
          throw Error("Missile launch body and envelope disagree");
        call(0x6e587e, { R15: object, RBP: frame }, base + 0x6e58ea);
        if (get("RCX") !== 0 || raw.getUint8(0x158) !== 1) return null;
        call(0x8920e2, { R13: object }, base + 0x892132);
        const elapsedBits = new DataView(new ArrayBuffer(4));
        elapsedBits.setUint32(0, get("EAX"), true);
        const packetElapsedSeconds = elapsedBits.getFloat32(0, true);
        if (packetElapsedSeconds !== 0) return null;
        const point = (offset) =>
          [0, 4, 8].map((axis) => raw.getFloat32(offset + axis, true));
        const castSourceXYZ = point(0xd0);
        const castTargetXYZ = point(0xdc);
        if (![...castSourceXYZ, ...castTargetXYZ].every(Number.isFinite))
          throw Error("Missile launch points must be finite");
        return {
          entity,
          sourceContext: owners[0],
          sourceName: names[0],
          requestedMissileSpellHash: spellKeys[0],
          castHash: raw.getUint32(0x14, true),
          castSourceXYZ,
          castTargetXYZ,
          forcedRecordedSource: true,
          packetElapsedSeconds,
          bodyBytes: payload.length,
        };
      },
    };
  } catch (error) {
    machine.close();
    throw error;
  }
}
