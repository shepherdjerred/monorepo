// JS implementations of the GBA BIOS calls the wasm build imports
// (CpuSet, LZ77/RL decompression, affine matrix setup, etc.). Ported from
// pokeemerald-wasm web/app.js importsFor(). The closures read live wasm memory
// via the u8/u16 views, which are refreshed after instantiation.

type AffineTerms = { pa: number; pb: number; pc: number; pd: number };

function affineTerms(
  xScale: number,
  yScale: number,
  rotation: number,
): AffineTerms {
  const angle = (rotation * Math.PI * 2) / 256;
  const sin = Math.sin(angle) * 256;
  const cos = Math.cos(angle) * 256;
  return {
    pa: (cos * xScale) / 256,
    pb: (-sin * yScale) / 256,
    pc: (sin * xScale) / 256,
    pd: (cos * yScale) / 256,
  };
}

export type Bios = {
  refresh: (memory: WebAssembly.Memory) => void;
  imports: (module: WebAssembly.Module) => Bun.WebAssembly.Imports;
};

// BIOS call arguments are positional per the ABI; a missing slot means the
// wasm caller violated the signature, so fail fast rather than defaulting.
function arg(args: number[], index: number): number {
  const value = args[index];
  if (value === undefined) {
    throw new Error(`BIOS arg missing at index ${String(index)}`);
  }
  return value;
}

export function createBios(): Bios {
  let u8 = new Uint8Array(0);
  let u16 = new Uint16Array(0);

  // Live wasm-memory reads are always in-bounds by the BIOS ABI; an
  // out-of-range index signals a corrupt call, so fail fast rather than
  // silently propagating an undefined into the arithmetic below.
  function rd8(index: number): number {
    const value = u8[index];
    if (value === undefined) {
      throw new Error(`BIOS u8 read out of range: ${String(index)}`);
    }
    return value;
  }
  function rd16(index: number): number {
    const value = u16[index];
    if (value === undefined) {
      throw new Error(`BIOS u16 read out of range: ${String(index)}`);
    }
    return value;
  }

  function copy(
    src: number,
    dst: number,
    count: number,
    opts: { size: number; fill: number },
  ): void {
    const { size, fill } = opts;
    for (let i = 0; i < count; i++) {
      const from = fill ? src : src + i * size;
      u8.set(u8.subarray(from, from + size), dst + i * size);
    }
  }

  function lz77(src: number, dst: number): void {
    const size = rd8(src + 1) | (rd8(src + 2) << 8) | (rd8(src + 3) << 16);
    let s = src + 4;
    let d = dst;
    const end = dst + size;
    while (d < end) {
      const flags = rd8(s++);
      for (let bit = 7; bit >= 0 && d < end; bit--) {
        if (flags & (1 << bit)) {
          const pair = (rd8(s) << 8) | rd8(s + 1);
          s += 2;
          let length = (pair >> 12) + 3;
          const disp = (pair & 0xf_ff) + 1;
          while (length-- && d < end) {
            u8[d] = rd8(d - disp);
            d++;
          }
        } else u8[d++] = rd8(s++);
      }
    }
  }

  function rl(src: number, dst: number): void {
    const size = rd8(src + 1) | (rd8(src + 2) << 8) | (rd8(src + 3) << 16);
    let s = src + 4;
    let d = dst;
    const end = dst + size;
    while (d < end) {
      const flag = rd8(s++);
      if (flag & 0x80) {
        let count = (flag & 0x7f) + 3;
        const value = rd8(s++);
        while (count-- && d < end) u8[d++] = value;
      } else {
        let count = (flag & 0x7f) + 1;
        while (count-- && d < end) u8[d++] = rd8(s++);
      }
    }
  }

  function readCString(ptr: number): string {
    let out = "";
    while (rd8(ptr)) out += String.fromCodePoint(rd8(ptr++));
    return out;
  }
  function readS16(ptr: number): number {
    return (rd16(ptr >> 1) << 16) >> 16;
  }
  function readS32(ptr: number): number {
    // The shift+or already yields a signed int32.
    return rd16(ptr >> 1) | (rd16((ptr + 2) >> 1) << 16);
  }
  function writeS16(ptr: number, value: number): void {
    u16[ptr >> 1] = value & 0xff_ff;
  }
  function writeS32(ptr: number, value: number): void {
    u16[ptr >> 1] = value & 0xff_ff;
    u16[(ptr + 2) >> 1] = (value >> 16) & 0xff_ff;
  }

  function bgAffineSet(src: number, dest: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = src + i * 20;
      const d = dest + i * 16;
      const texX = readS32(s);
      const texY = readS32(s + 4);
      const scrX = readS16(s + 8);
      const scrY = readS16(s + 10);
      const { pa, pb, pc, pd } = affineTerms(
        readS16(s + 12),
        readS16(s + 14),
        rd16((s + 16) >> 1),
      );
      const a = Math.trunc(pa);
      const b = Math.trunc(pb);
      const c = Math.trunc(pc);
      const e = Math.trunc(pd);
      writeS16(d, a);
      writeS16(d + 2, b);
      writeS16(d + 4, c);
      writeS16(d + 6, e);
      writeS32(d + 8, texX - scrX * a - scrY * b);
      writeS32(d + 12, texY - scrX * c - scrY * e);
    }
  }

  function objAffineSet(
    src: number,
    dest: number,
    count: number,
    offset: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const s = src + i * 6;
      const d = dest + i * offset * 4;
      const { pa, pb, pc, pd } = affineTerms(
        readS16(s),
        readS16(s + 2),
        rd16((s + 4) >> 1),
      );
      writeS16(d, Math.trunc(pa));
      writeS16(d + offset, Math.trunc(pb));
      writeS16(d + offset * 2, Math.trunc(pc));
      writeS16(d + offset * 3, Math.trunc(pd));
    }
  }

  function dispatch(name: string, args: number[]): number {
    switch (name) {
      case "CpuSet":
        copy(arg(args, 0), arg(args, 1), arg(args, 2) & 0x1f_ff_ff, {
          size: (arg(args, 2) >>> 26) & 1 ? 4 : 2,
          fill: (arg(args, 2) >>> 24) & 1,
        });
        return 0;
      case "CpuFastSet":
        copy(arg(args, 0), arg(args, 1), arg(args, 2) & 0x1f_ff_ff, {
          size: 4,
          fill: (arg(args, 2) >>> 24) & 1,
        });
        return 0;
      case "LZ77UnCompWram":
      case "LZ77UnCompVram":
        lz77(arg(args, 0), arg(args, 1));
        return 0;
      case "RLUnCompWram":
      case "RLUnCompVram":
        rl(arg(args, 0), arg(args, 1));
        return 0;
      case "BgAffineSet":
        bgAffineSet(arg(args, 0), arg(args, 1), arg(args, 2));
        return 0;
      case "ObjAffineSet":
        objAffineSet(arg(args, 0), arg(args, 1), arg(args, 2), arg(args, 3));
        return 0;
      case "Div":
        return arg(args, 1) ? Math.trunc(arg(args, 0) / arg(args, 1)) : 0;
      case "Sqrt":
        return Math.trunc(Math.sqrt(arg(args, 0)));
      case "strcmp":
        return readCString(arg(args, 0)).localeCompare(
          readCString(arg(args, 1)),
        );
      // libc bulk-memory calls. Whether these appear as imports depends on the
      // LLVM version that compiled the wasm: newer clangs lower them to inline
      // bulk-memory ops, older ones (e.g. trixie's clang-19, used by the Dagger
      // image build) emit calls to external libc symbols, which surface here.
      // They return the destination/comparison result per the C signatures.
      case "memcpy":
      case "memmove":
        u8.copyWithin(arg(args, 0), arg(args, 1), arg(args, 1) + arg(args, 2));
        return arg(args, 0);
      case "memset":
        u8.fill(arg(args, 1) & 0xff, arg(args, 0), arg(args, 0) + arg(args, 2));
        return arg(args, 0);
      case "memcmp": {
        for (let i = 0; i < arg(args, 2); i++) {
          const diff = rd8(arg(args, 0) + i) - rd8(arg(args, 1) + i);
          if (diff !== 0) return diff;
        }
        return 0;
      }
      default:
        // NOOP_IMPORTS are validated in imports(); anything else is a bug.
        return 0;
    }
  }

  return {
    refresh(memory: WebAssembly.Memory): void {
      u8 = new Uint8Array(memory.buffer);
      u16 = new Uint16Array(memory.buffer);
    },
    imports(module: WebAssembly.Module): Bun.WebAssembly.Imports {
      const env: Record<string, Bun.WebAssembly.ImportValue> = {};
      for (const item of WebAssembly.Module.imports(module)) {
        if (item.kind !== "function") continue;
        // Every function import we satisfy lives on the `env` namespace. A wasm
        // built to import from another module (e.g. `wasi_snapshot_preview1`)
        // could name-collide with an entry below and pass validation, yet the
        // engine would still fail to instantiate because it expects that other
        // namespace. Fail fast with an actionable error instead.
        if (item.module !== "env") {
          throw new Error(
            `wasm module imports function from unexpected namespace ` +
              `"${item.module}" (${item.name}) — bios.ts only provides the ` +
              `"env" namespace`,
          );
        }
        const name = item.name;
        if (!IMPLEMENTED_IMPORTS.has(name) && !NOOP_IMPORTS.has(name)) {
          throw new Error(
            `wasm module imports unimplemented host function: ${name} — ` +
              "implement it in bios.ts (a silent no-op corrupts emulation, " +
              "e.g. missing memcpy blacks out all graphics)",
          );
        }
        env[name] = (...args: number[]): number => dispatch(name, args);
      }
      return { env };
    },
  };
}

// Every function import the wasm may declare must be listed here (implemented
// in dispatch()) or in NOOP_IMPORTS (intentionally a no-op). Unknown imports
// fail instantiation instead of silently returning 0 mid-game.
const IMPLEMENTED_IMPORTS = new Set([
  "CpuSet",
  "CpuFastSet",
  "LZ77UnCompWram",
  "LZ77UnCompVram",
  "RLUnCompWram",
  "RLUnCompVram",
  "BgAffineSet",
  "ObjAffineSet",
  "Div",
  "Sqrt",
  "strcmp",
  "memcpy",
  "memmove",
  "memset",
  "memcmp",
]);

// BIOS calls the game invokes but that are safe to ignore headlessly (link
// cable / multiboot / reset paths); matches upstream web/app.js, which also
// no-ops them. ArcTan2 returning 0 is upstream behavior too.
const NOOP_IMPORTS = new Set([
  "ArcTan2",
  "SoftReset",
  "RegisterRamReset",
  "MultiBoot",
  "GameCubeMultiBoot_Init",
  "GameCubeMultiBoot_Main",
  "GameCubeMultiBoot_ExecuteProgram",
  "GameCubeMultiBoot_HandleSerialInterrupt",
  "GameCubeMultiBoot_Quit",
]);
