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
  imports: (
    module: WebAssembly.Module,
    opts?: { extras?: Record<string, (args: number[]) => number> },
  ) => WebAssembly.Imports;
};

export function createBios(): Bios {
  let u8 = new Uint8Array(0);
  let u16 = new Uint16Array(0);

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
    const size = u8[src + 1] | (u8[src + 2] << 8) | (u8[src + 3] << 16);
    let s = src + 4;
    let d = dst;
    const end = dst + size;
    while (d < end) {
      const flags = u8[s++];
      for (let bit = 7; bit >= 0 && d < end; bit--) {
        if (flags & (1 << bit)) {
          const pair = (u8[s] << 8) | u8[s + 1];
          s += 2;
          let length = (pair >> 12) + 3;
          const disp = (pair & 0xf_ff) + 1;
          while (length-- && d < end) {
            u8[d] = u8[d - disp];
            d++;
          }
        } else u8[d++] = u8[s++];
      }
    }
  }

  function rl(src: number, dst: number): void {
    const size = u8[src + 1] | (u8[src + 2] << 8) | (u8[src + 3] << 16);
    let s = src + 4;
    let d = dst;
    const end = dst + size;
    while (d < end) {
      const flag = u8[s++];
      if (flag & 0x80) {
        let count = (flag & 0x7f) + 3;
        const value = u8[s++];
        while (count-- && d < end) u8[d++] = value;
      } else {
        let count = (flag & 0x7f) + 1;
        while (count-- && d < end) u8[d++] = u8[s++];
      }
    }
  }

  function readCString(ptr: number): string {
    let out = "";
    while (u8[ptr]) out += String.fromCodePoint(u8[ptr++]);
    return out;
  }
  function readS16(ptr: number): number {
    return (u16[ptr >> 1] << 16) >> 16;
  }
  function readS32(ptr: number): number {
    // The shift+or already yields a signed int32.
    return u16[ptr >> 1] | (u16[(ptr + 2) >> 1] << 16);
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
        u16[(s + 16) >> 1],
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
        u16[(s + 4) >> 1],
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
        copy(args[0], args[1], args[2] & 0x1f_ff_ff, {
          size: (args[2] >>> 26) & 1 ? 4 : 2,
          fill: (args[2] >>> 24) & 1,
        });
        return 0;
      case "CpuFastSet":
        copy(args[0], args[1], args[2] & 0x1f_ff_ff, {
          size: 4,
          fill: (args[2] >>> 24) & 1,
        });
        return 0;
      case "LZ77UnCompWram":
      case "LZ77UnCompVram":
        lz77(args[0], args[1]);
        return 0;
      case "RLUnCompWram":
      case "RLUnCompVram":
        rl(args[0], args[1]);
        return 0;
      case "BgAffineSet":
        bgAffineSet(args[0], args[1], args[2]);
        return 0;
      case "ObjAffineSet":
        objAffineSet(args[0], args[1], args[2], args[3]);
        return 0;
      case "Div":
        return args[1] ? Math.trunc(args[0] / args[1]) : 0;
      case "Sqrt":
        return Math.trunc(Math.sqrt(args[0]));
      case "strcmp":
        return readCString(args[0]).localeCompare(readCString(args[1]));
      default:
        return 0;
    }
  }

  return {
    refresh(memory: WebAssembly.Memory): void {
      u8 = new Uint8Array(memory.buffer);
      u16 = new Uint16Array(memory.buffer);
    },
    imports(
      module: WebAssembly.Module,
      opts?: { extras?: Record<string, (args: number[]) => number> },
    ): WebAssembly.Imports {
      const env: Record<string, WebAssembly.ImportValue> = {};
      const extras = opts?.extras ?? {};
      for (const item of WebAssembly.Module.imports(module)) {
        if (item.kind !== "function") continue;
        const name = item.name;
        if (Object.hasOwn(extras, name)) {
          const override = extras[name];
          env[name] = (...args: number[]): number => override(args);
        } else {
          env[name] = (...args: number[]): number => dispatch(name, args);
        }
      }
      return { env };
    },
  };
}
