import { NativeDecoder } from "./native-decoder.mjs";

// Build-pinned structural observations. This layer assigns no gameplay meanings.
export class StructuralDecoder extends NativeDecoder {
  constructor(uc, profile, image, constructors) {
    if (
      profile.schema !== 1 ||
      profile.status !== "structural-candidate" ||
      profile.callingConvention !== "sysv-x86_64"
    )
      throw Error("Unsupported structural decoder profile");
    if (image.length !== profile.sizeOfImage)
      throw Error("Structural decoder image size mismatch");
    super(uc, profile, image, { captureWrites: false });
    if (constructors?.length !== profile.constructorImageBytes)
      throw Error("Missing constructor image");
    this.constructors = constructors;
    this.image = image;
    this.dirtyPages = new Set();
    this.engine.hook_add(
      uc.HOOK_MEM_WRITE,
      (_engine, _type, address, size) => {
        const start = Number(address) - profile.imageBase;
        for (let page = start & ~4095; page < start + size; page += 4096)
          this.dirtyPages.add(page);
      },
      null,
      profile.imageBase,
      profile.imageBase + image.length - 1,
    );
  }
  observePacket(opcode, payload, param) {
    if (
      !Number.isInteger(opcode) ||
      opcode < 0 ||
      opcode > this.profile.maxOpcode
    )
      throw Error("Packet opcode outside exact-build factory");
    if (
      !Number.isInteger(param) ||
      param < 0 ||
      param > 0xffffffff ||
      payload.length > 0x1f0000
    )
      throw Error("Invalid structural packet input");
    const e = this.engine,
      uc = this.uc,
      base = this.profile.imageBase;
    const used = this.readU32(NativeDecoder.CURSOR);
    if (used > 0x1ff000) throw Error("Invalid decoder arena cursor");
    e.context_restore(this.context);
    for (const page of this.dirtyPages)
      e.mem_write(base + page, this.image.subarray(page, page + 4096));
    this.dirtyPages.clear();
    if (used) e.mem_write(NativeDecoder.HEAP, new Uint8Array(used));
    if (this.lastSize) e.mem_write(0x10010000, new Uint8Array(this.lastSize));
    e.mem_write(0x201f0000, this.zero);
    this.lastSize = payload.length;
    this.u64(NativeDecoder.CURSOR, 0);
    const config = this.profile.packets[opcode];
    if (!config) throw Error(`Unprepared packet opcode ${opcode}`);
    const { offset, length, objectSize: size, entryRva } = config;
    if (
      ![offset, length, size, entryRva].every(Number.isSafeInteger) ||
      offset < 0 ||
      length < size ||
      length > 0x1ff000 ||
      size < 16 ||
      size > 0x10000 ||
      offset + length > this.constructors.length
    )
      throw Error("Invalid prepared packet constructor");
    const object = NativeDecoder.HEAP,
      entry = base + entryRva;
    e.mem_write(object, this.constructors.subarray(offset, offset + length));
    this.u64(NativeDecoder.CURSOR, length);
    const context = new Uint8Array(4);
    new DataView(context.buffer).setUint32(0, param, true);
    e.mem_write(object + 12, context);
    e.mem_write(0x10010000, payload);
    this.u64(0x10008000, 0x10010000);
    e.reg_write_i64(uc.X86_REG_RDI, BigInt(object));
    e.reg_write_i64(uc.X86_REG_RSI, 0x10008000n);
    e.reg_write_i64(uc.X86_REG_RDX, BigInt(0x10010000 + payload.length));
    this.call(entry);
    const accepted = Number(e.reg_read_i64(uc.X86_REG_RAX) & 255n) === 1;
    const consumed =
      Number(
        new DataView(this.read(0x10008000, 8).buffer).getBigUint64(0, true),
      ) - 0x10010000;
    const heapSize = this.readU32(NativeDecoder.CURSOR);
    if (heapSize > 0x1ff000 || consumed < 0 || consumed > payload.length)
      throw Error("Decoder exceeded packet/arena bounds");
    return {
      accepted,
      consumed,
      complete: accepted && consumed === payload.length,
      entryRva: entry - base,
      object: this.read(object, size),
      heap: this.read(NativeDecoder.HEAP, heapSize),
    };
  }
}
