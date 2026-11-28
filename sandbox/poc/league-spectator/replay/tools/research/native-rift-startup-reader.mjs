const pageSize = 0x1000;
const arena = 0x10000000;
const arenaEnd = arena + 0x100000;
const packet = arena + 0x1000;
const config = arena + 0x2000;
const cursor = arena + 0x3000;
const wire = arena + 0x4000;
const stack = arena + 0xf008;
const heapStart = arena + 0x10000;
const originDigest =
  "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7";
const pageDigest =
  "087dce77eb40947cedccbb8a8263ab7e0b8156897b6356236cba706350d44f9b";
const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const digest = async (bytes) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

export async function createStartupReader(uc, profile, imagePages) {
  if (
    profile.base !== 0x100000000 ||
    profile.archiveSha256 !== originDigest ||
    profile.pageSha256 !== pageDigest ||
    !Array.isArray(profile.pages) ||
    profile.pages.length !== 61 ||
    imagePages.byteLength !== profile.pages.length * pageSize ||
    (await digest(imagePages)) !== pageDigest ||
    profile.pages.some(
      (page, index) =>
        !Number.isSafeInteger(page) ||
        page < 0 ||
        page % pageSize !== 0 ||
        (index > 0 && page <= profile.pages[index - 1]),
    )
  ) {
    throw Error("Unsupported exact .8428 startup image");
  }
  const hostCalls = new Map([
    [0x1637cb0, "set-replay-context"],
    [0x14a0300, "allocate"],
    [0x14a2030, "allocate"],
    [0x14c5b20, "allocate"],
    ...Object.entries(profile.imports).map(([address, name]) => [
      Number(address),
      name,
    ]),
  ]);
  return (payload) => {
    if (
      !(payload instanceof Uint8Array) ||
      payload.length === 0 ||
      payload.length > 0x8000
    )
      throw Error("Invalid .8428 startup packet length");
    const machine = new uc.Unicorn(uc.ARCH_X86, uc.MODE_64);
    const base = profile.base;
    let heap = heapStart;
    const reg = (name) => uc["X86_REG_" + name];
    const register = (name) => Number(machine.reg_read_i64(reg(name)));
    const set = (name, value) =>
      machine.reg_write_i64(reg(name), BigInt(value));
    const view = (bytes) =>
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const read = (address, length) =>
      new Uint8Array(machine.mem_read(address, length));
    const read64 = (address) =>
      Number(view(read(address, 8)).getBigUint64(0, true));
    const write64 = (address, value) => {
      const out = new Uint8Array(8);
      view(out).setBigUint64(0, BigInt(value), true);
      machine.mem_write(address, out);
    };
    function returnHost(value) {
      const sp = register("RSP");
      set("RAX", value);
      set("RIP", read64(sp));
      set("RSP", sp + 8);
    }
    function host(name) {
      const target = register("RDI");
      if (name === "set-replay-context") {
        machine.mem_write(target + 12, new Uint8Array(4));
        returnHost(1);
      } else if (name === "allocate") {
        if (
          !Number.isSafeInteger(target) ||
          target < 0 ||
          target > arenaEnd - heap
        )
          throw Error("Startup allocation exceeds arena");
        const allocated = heap;
        heap += Math.max(32, Math.ceil(target / 32) * 32);
        if (heap > arenaEnd) throw Error("Startup allocation exceeds arena");
        returnHost(allocated);
      } else if (name === "___cxa_guard_acquire") {
        returnHost(read(target, 1)[0] === 0 ? 1 : 0);
      } else if (name === "___cxa_guard_release") {
        machine.mem_write(target, Uint8Array.of(1));
        returnHost(0);
      } else if (name === "___cxa_atexit") {
        returnHost(0);
      } else if (name === "___bzero") {
        const length = register("RSI");
        if (
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > arenaEnd - arena
        )
          throw Error("Startup clear exceeds arena");
        machine.mem_write(target, new Uint8Array(length));
        returnHost(target);
      } else {
        throw Error("Unsupported .8428 startup host call " + name);
      }
    }
    function call(entry, registers, stop = arena) {
      set("RSP", stack);
      set("RBP", 0);
      write64(stack, arena);
      for (const [name, value] of Object.entries(registers)) set(name, value);
      machine.emu_start(base + entry, stop, 0, 500_000);
      if (register("RIP") !== stop)
        throw Error("Startup instruction budget exceeded");
      return register("RAX");
    }
    try {
      machine.mem_map(arena, arenaEnd - arena, uc.PROT_ALL);
      for (const [index, page] of profile.pages.entries()) {
        machine.mem_map(base + page, pageSize, uc.PROT_ALL);
        machine.mem_write(
          base + page,
          imagePages.subarray(index * pageSize, (index + 1) * pageSize),
        );
      }
      for (const guard of profile.guard) write64(base + guard, arena);
      for (const [rva, name] of hostCalls) {
        if (!profile.pages.includes(rva & ~(pageSize - 1))) continue;
        machine.hook_add(
          uc.HOOK_CODE,
          () => host(name),
          null,
          base + rva,
          base + rva,
        );
      }
      write64(cursor, wire);
      machine.mem_write(wire, payload);
      call(0x10203b0, { RDI: packet });
      const accepted = call(0x11f3c70, {
        RDI: packet,
        RSI: cursor,
        RDX: wire + payload.length,
      });
      if ((accepted & 255) !== 1 || read64(cursor) !== wire + payload.length)
        throw Error("Original startup reader did not consume the entire body");
      const modeInfo = view(read(packet + 0xe0, 16));
      const pointer = Number(modeInfo.getBigUint64(0, true));
      const length = modeInfo.getUint32(8, true);
      const capacity = modeInfo.getUint32(12, true);
      if (
        pointer < heapStart ||
        pointer + capacity > heap ||
        length === 0 ||
        capacity > 129 ||
        length >= capacity
      )
        throw Error("Invalid startup mode allocation");
      const modeBytes = read(pointer, length + 1);
      const mode = text.decode(modeBytes.subarray(0, length));
      if (modeBytes[length] !== 0 || !/^[A-Z][A-Z0-9_]*$/u.test(mode))
        throw Error("Invalid startup mode");
      call(0x706377, { R14: packet }, base + 0x70637e);
      const source = register("RSI");
      if (source !== packet + 0x78)
        throw Error("Unexpected startup configuration");
      call(0x635741, { RDI: config, RSI: source }, base + 0x6357fc);
      const configuredMapId = call(0x636ee0, { RDI: config }) >>> 0;
      if (configuredMapId === 0) throw Error("Invalid startup map");
      return { configuredMapId, mode };
    } finally {
      machine.close();
    }
  };
}
