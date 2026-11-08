// Bounded AVX semantics for isolated, pinned math kernels. No game semantics.
import { fusedFloatBits } from "./latest-fused-math.mjs";

const mask = (width) => (1n << BigInt(width)) - 1n;
const scratch = new DataView(new ArrayBuffer(8));
const number = (bits, width) => {
  scratch.setBigUint64(0, bits & mask(width), true);
  return width === 32
    ? scratch.getFloat32(0, true)
    : scratch.getFloat64(0, true);
};
const encode = (value, width) => {
  if (width === 32) scratch.setFloat32(0, value, true);
  else scratch.setFloat64(0, value, true);
  return scratch.getBigUint64(0, true) & mask(width);
};
const signed = (bits, width) => BigInt.asIntN(width, bits);

export function executeMathInstruction(
  ins,
  dest,
  two,
  three,
  integerBytes = 8,
) {
  const vectorBits = ins.vectorBytes * 8,
    kind = ins.kind;
  if (kind === "bits") {
    const op = ins.operation;
    return (
      (op === "and"
        ? two & three
        : op === "andn"
          ? ~two & three
          : op === "or"
            ? two | three
            : two ^ three) & mask(vectorBits)
    );
  }
  if (["float", "convert", "round", "fma"].includes(kind)) {
    const width = ins.precision,
      laneMask = mask(width);
    let output =
      kind === "fma"
        ? ins.lanes === 1
          ? dest & mask(128)
          : 0n
        : kind !== "float" || ins.scalar
          ? two & mask(128)
          : 0n;
    const lanes = ["convert", "round"].includes(kind) ? 1 : ins.lanes;
    for (let lane = 0; lane < lanes; lane++) {
      const shift = BigInt(lane * width),
        aBits = (two >> shift) & laneMask,
        bBits = (three >> shift) & laneMask;
      let result;
      if (kind === "fma") {
        const dBits = (dest >> shift) & laneMask;
        let a, b, c;
        if (ins.order === 132) [a, b, c] = [dBits, bBits, aBits];
        else if (ins.order === 213) [a, b, c] = [aBits, dBits, bBits];
        else if (ins.order === 231) [a, b, c] = [aBits, bBits, dBits];
        else throw Error("Unknown fused operand order");
        if (ins.negateProduct) a ^= 1n << BigInt(width - 1);
        if (ins.subtractAddend) c ^= 1n << BigInt(width - 1);
        result = fusedFloatBits(a, b, c, width);
      } else if (kind === "convert") {
        if (["vmovss", "vmovsd"].includes(ins.mnemonic))
          result = three & laneMask;
        else
          result = encode(
            ins.integerSource
              ? Number(signed(three, integerBytes * 8))
              : number(three, ins.sourcePrecision),
            width,
          );
      } else if (kind === "round") {
        if (ins.immediate & 4)
          throw Error("MXCSR-controlled rounding requires another contract");
        const value = number(three, width);
        let rounded;
        switch (ins.immediate & 3) {
          case 0: {
            const low = Math.floor(value),
              fraction = value - low;
            rounded =
              fraction < 0.5
                ? low
                : fraction > 0.5
                  ? low + 1
                  : low % 2 === 0
                    ? low
                    : low + 1;
            break;
          }
          case 1:
            rounded = Math.floor(value);
            break;
          case 2:
            rounded = Math.ceil(value);
            break;
          case 3:
            rounded = Math.trunc(value);
            break;
        }
        if (rounded === 0) rounded = value < 0 || Object.is(value, -0) ? -0 : 0;
        result = encode(Number.isFinite(value) ? rounded : value, width);
      } else {
        const a = number(aBits, width),
          b = number(bBits, width),
          op = ins.operation;
        if (op === "max" || op === "min")
          result = (op === "max" ? a > b : a < b) ? aBits : bBits;
        else {
          let value;
          if (op === "add") value = a + b;
          else if (op === "sub") value = a - b;
          else if (op === "mul") value = a * b;
          else if (op === "div") value = a / b;
          else if (op === "sqrt") value = Math.sqrt(b);
          else throw Error("Unknown vector floating operation");
          result = encode(value, width);
        }
      }
      output = (output & ~(laneMask << shift)) | (result << shift);
    }
    return output & mask(vectorBits);
  }
  if (kind === "integer" || kind === "shift") {
    const width = ins.precision,
      laneMask = mask(width);
    let output = 0n;
    for (let lane = 0; lane < vectorBits / width; lane++) {
      const shift = BigInt(lane * width),
        a = (two >> shift) & laneMask,
        b = (three >> shift) & laneMask;
      let value;
      const op = ins.operation;
      if (kind === "shift") {
        const n = three & mask(64);
        if (op === "ll") value = n >= BigInt(width) ? 0n : a << n;
        else if (op === "rl") value = n >= BigInt(width) ? 0n : a >> n;
        else
          value = signed(a, width) >> (n > BigInt(width) ? BigInt(width) : n);
      } else if (op === "add") value = a + b;
      else if (op === "sub") value = a - b;
      else if (op === "eq") value = a === b ? laneMask : 0n;
      else if (op === "gt")
        value = signed(a, width) > signed(b, width) ? laneMask : 0n;
      else throw Error("Unknown vector integer operation");
      output |= (value & laneMask) << shift;
    }
    return output;
  }
  if (kind === "shuffle" || kind === "unpack") {
    const width = ins.precision,
      laneMask = mask(width);
    let output = 0n;
    for (let block = 0; block < vectorBits / 128; block++) {
      const a = [],
        b = [];
      for (let i = 0; i < 128 / width; i++) {
        const shift = BigInt(block * 128 + i * width);
        a.push((two >> shift) & laneMask);
        b.push((three >> shift) & laneMask);
      }
      let values;
      if (kind === "shuffle") {
        const imm = ins.immediate;
        values =
          width === 32
            ? [
                a[imm & 3],
                a[(imm >> 2) & 3],
                b[(imm >> 4) & 3],
                b[(imm >> 6) & 3],
              ]
            : [a[(imm >> (block * 2)) & 1], b[(imm >> (block * 2 + 1)) & 1]];
      } else {
        values = [];
        const start = ins.high ? a.length / 2 : 0;
        for (let i = start; i < start + a.length / 2; i++)
          values.push(a[i], b[i]);
      }
      for (let i = 0; i < values.length; i++)
        output |= values[i] << BigInt(block * 128 + i * width);
    }
    return output;
  }
  throw Error(
    `Unported vector math instruction ${ins.mnemonic} at ${ins.rva.toString(16)}`,
  );
}

export function readVector(engine, register, bytes = 32) {
  const b = engine.reg_read(register, bytes);
  let value = 0n;
  for (let i = b.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(b[i]);
  return value;
}
export function writeVector(engine, register, value, bytes = 32) {
  const b = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    b[i] = Number(value & 255n);
    value >>= 8n;
  }
  engine.reg_write(register, b);
}

export function installMathIsa(uc, engine, catalog) {
  const instructions = new Map(catalog.isaInstructions.map((i) => [i.rva, i]));
  const base = catalog.source.preferredBase;
  let count = 0;
  engine.hook_add(
    uc.HOOK_INTR,
    (_e, interrupt) => {
      const address = Number(engine.reg_read_i64(uc.X86_REG_RIP)) - 1,
        ins = instructions.get(address - base);
      if (interrupt !== 3 || !ins) throw Error("Unowned math ISA interrupt");
      if (Number(engine.reg_read_i32(uc.X86_REG_MXCSR)) & 0xe040)
        throw Error(
          "Math requires nearest-even rounding and gradual underflow",
        );
      const original = engine.mem_read(address, ins.bytes);
      if (original[0] !== 0xcc || original.slice(1).some((b) => b !== 0x90))
        throw Error("Lowered math instruction changed");
      const dest = readVector(engine, uc[`X86_REG_YMM${ins.destination}`]),
        two = readVector(engine, uc[`X86_REG_YMM${ins.source2}`]);
      const source = ins.source3;
      let three;
      if (source.register !== undefined)
        three = readVector(engine, uc[`X86_REG_YMM${source.register}`]);
      else if (source.integerRegister) {
        const reg = uc[`X86_REG_${source.integerRegister.toUpperCase()}`];
        three =
          source.bytes === 4
            ? BigInt(engine.reg_read_i32(reg) >>> 0)
            : engine.reg_read_i64(reg);
      } else if (source.immediate !== undefined)
        three = BigInt(source.immediate);
      else {
        const m = source.memory;
        let pointer =
          m.base === "rip"
            ? address + ins.bytes
            : m.base
              ? Number(
                  engine.reg_read_i64(uc[`X86_REG_${m.base.toUpperCase()}`]),
                )
              : 0;
        if (m.index)
          pointer +=
            Number(
              engine.reg_read_i64(uc[`X86_REG_${m.index.toUpperCase()}`]),
            ) * m.scale;
        pointer += m.displacement;
        const b = engine.mem_read(pointer, m.bytes);
        three = 0n;
        for (let i = b.length - 1; i >= 0; i--)
          three = (three << 8n) | BigInt(b[i]);
      }
      const output = executeMathInstruction(
        ins,
        dest,
        two,
        three,
        source.bytes ?? source.memory?.bytes ?? 8,
      );
      writeVector(engine, uc[`X86_REG_YMM${ins.destination}`], output);
      engine.reg_write_i64(uc.X86_REG_RIP, BigInt(address + ins.bytes));
      count++;
    },
    null,
    1,
    0,
  );
  return {
    get count() {
      return count;
    },
  };
}
