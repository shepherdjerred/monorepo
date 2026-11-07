// Isolated packet-function execution. Memory layout follows RoflLens (MIT notice included).
// This runs neither a Windows process nor the game loop.
export class NativeDecoder {
  static IO = 0x10000000;
  static HEAP = 0x10200000;
  static CURSOR = 0x103ff000;
  static STACK = 0x20000000;
  static OUTPUT = 0x10001000;
  constructor(uc, profile, image, { captureWrites = true } = {}) {
    this.uc = uc;
    this.profile = profile;
    this.engine = new uc.Unicorn(uc.ARCH_X86, uc.MODE_64);
    const e = this.engine;
    e.mem_map(profile.imageBase, image.length, uc.PROT_ALL);
    e.mem_write(profile.imageBase, image);
    e.mem_map(NativeDecoder.IO, 0x400000, uc.PROT_ALL);
    e.mem_map(NativeDecoder.STACK, 0x200000, uc.PROT_ALL);
    e.mem_write(NativeDecoder.IO, new Uint8Array(0x400000));
    e.mem_write(NativeDecoder.STACK, new Uint8Array(0x200000));
    this.context = e.context_alloc();
    e.context_save(this.context);
    this.writes = [];
    this.heapWrites = [];
    this.zero = new Uint8Array(0x10000);
    if (captureWrites)
      e.hook_add(
        uc.HOOK_MEM_WRITE,
        (_e, _type, address, size, value) => {
          this.writes.push([
            Number(address) - NativeDecoder.OUTPUT,
            size,
            value,
          ]);
        },
        null,
        NativeDecoder.OUTPUT,
        NativeDecoder.OUTPUT + 0x3ff,
      );
    if (captureWrites)
      e.hook_add(
        uc.HOOK_MEM_WRITE,
        (_e, _type, address, size, value) => {
          this.heapWrites.push([
            Number(address) - NativeDecoder.HEAP,
            size,
            value,
          ]);
        },
        null,
        NativeDecoder.HEAP,
        NativeDecoder.CURSOR - 1,
      );
  }
  u64(address, value) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(value), true);
    this.engine.mem_write(address, b);
  }
  read(address, size) {
    return new Uint8Array(this.engine.mem_read(address, size));
  }
  readU32(address) {
    return new DataView(this.read(address, 4).buffer).getUint32(0, true);
  }
  call(start) {
    const e = this.engine,
      uc = this.uc,
      stack =
        NativeDecoder.STACK +
        0x200000 -
        0x1000 +
        (this.profile.callingConvention === "sysv-x86_64" ? 8 : 0);
    if (
      !Number.isSafeInteger(start) ||
      start < this.profile.imageBase ||
      start >= this.profile.imageBase + this.profile.sizeOfImage
    )
      throw Error("Invalid native function entry");
    // One dedicated return address avoids reusing another decoder's entry as an
    // emulation stop. Such entries may already exist in Unicorn's block cache.
    const stop = 0x10009000;
    this.u64(stack, stop);
    e.reg_write_i64(uc.X86_REG_RSP, BigInt(stack));
    try {
      e.emu_start(start, stop, 0, 5000000);
    } catch (error) {
      throw Error(
        `${error}; entry=${start.toString(16)} RIP=${e.reg_read_i64(uc.X86_REG_RIP).toString(16)}`,
      );
    }
    if (Number(e.reg_read_i64(uc.X86_REG_RIP)) !== stop)
      throw Error("Packet decoder instruction limit exceeded");
  }
  observe(name, payload, { constructorWrites = true } = {}) {
    if (payload.length > 0x1f0000)
      throw Error("Packet exceeds isolated decoder memory");
    const config = this.profile.decoders[name];
    if (!config?.entryRva) throw Error(`Missing native decoder ${name}`);
    const e = this.engine,
      uc = this.uc,
      base = this.profile.imageBase;
    const used = this.readU32(NativeDecoder.CURSOR);
    if (used > 0x1ff000) throw Error("Invalid decoder heap size");
    e.context_restore(this.context);
    if (used) e.mem_write(NativeDecoder.HEAP, new Uint8Array(used));
    if (this.lastSize) e.mem_write(0x10010000, new Uint8Array(this.lastSize));
    e.mem_write(NativeDecoder.OUTPUT, this.zero.subarray(0, 0x400));
    e.mem_write(0x201f0000, this.zero);
    e.mem_write(0x10010000, payload);
    this.lastSize = payload.length;
    this.u64(0x10008000, 0x10010000);
    this.u64(NativeDecoder.CURSOR, 0);
    this.writes = [];
    this.heapWrites = [];
    if (config.constructorRva) {
      e.reg_write_i64(uc.X86_REG_RCX, BigInt(NativeDecoder.OUTPUT));
      this.call(base + Number(config.constructorRva));
      if (!constructorWrites) this.writes = [];
      this.heapWrites = [];
    }
    e.reg_write_i64(uc.X86_REG_RCX, BigInt(NativeDecoder.OUTPUT));
    e.reg_write_i64(uc.X86_REG_RDX, 0x10008000n);
    e.reg_write_i64(uc.X86_REG_R8, BigInt(0x10010000 + payload.length));
    this.call(base + Number(config.entryRva));
    const heapSize = this.readU32(NativeDecoder.CURSOR);
    if (heapSize > 0x1ff000) throw Error("Decoder heap exceeded limit");
    return {
      output: this.read(NativeDecoder.OUTPUT, 0x400),
      heap: this.read(NativeDecoder.HEAP, heapSize),
      writes: this.writes,
      heapWrites: this.heapWrites,
    };
  }
  close() {
    this.engine.context_free(this.context);
    this.engine.close();
  }
}
