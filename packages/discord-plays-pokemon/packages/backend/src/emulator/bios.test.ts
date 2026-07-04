import { describe, expect, test } from "bun:test";
import { createBios } from "./bios.ts";

// Hand-encode a minimal wasm module whose only content is `env.<name>`
// function imports. That's all createBios().imports() inspects, and it lets
// these tests call the returned host closures directly as plain JS functions.
const uleb = (n: number): number[] => {
  const out: number[] = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
};

const str = (s: string): number[] => {
  const encoded = [...new TextEncoder().encode(s)];
  return [...uleb(encoded.length), ...encoded];
};

const section = (id: number, body: number[]): number[] => [
  id,
  ...uleb(body.length),
  ...body,
];

function moduleWithImports(
  namespace: string,
  names: string[],
): WebAssembly.Module {
  const bytes: number[] = [];
  bytes.push(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
  // type section: one functype () -> ()
  bytes.push(...section(1, [0x01, 0x60, 0x00, 0x00]));
  // import section: <namespace>.<name> function imports, all typeidx 0
  const importBody = [
    ...uleb(names.length),
    ...names.flatMap((name) => [...str(namespace), ...str(name), 0x00, 0x00]),
  ];
  bytes.push(...section(2, importBody));
  return new WebAssembly.Module(Uint8Array.from(bytes));
}

const moduleWithEnvImports = (names: string[]): WebAssembly.Module =>
  moduleWithImports("env", names);

// Extract the callable host closure for `name` without type assertions.
function hostFunction(
  imports: WebAssembly.Imports,
  name: string,
): (...args: number[]) => number {
  const env = imports.env;
  if (env === undefined) throw new Error("imports has no env module");
  const value = env[name];
  if (typeof value !== "function") {
    throw new TypeError(`env.${name} is not a function`);
  }
  return (...args: number[]): number => {
    const result = Reflect.apply(value, undefined, args);
    if (typeof result !== "number") {
      throw new TypeError(`env.${name} did not return a number`);
    }
    return result;
  };
}

function biosWithMemory(names: string[]): {
  env: WebAssembly.Imports;
  view: Uint8Array;
} {
  const bios = createBios();
  const memory = new WebAssembly.Memory({ initial: 1 });
  const env = bios.imports(moduleWithEnvImports(names));
  bios.refresh(memory);
  return { env, view: new Uint8Array(memory.buffer) };
}

describe("bios libc imports", () => {
  // trixie's clang-19 (the Dagger toolchain) emits memcpy/memmove/memset/
  // memcmp as host imports instead of inline bulk-memory ops. Before these
  // were implemented they silently no-op'd, which blacked out all graphics.
  test("memcpy copies bytes and returns dst", () => {
    const { env, view } = biosWithMemory(["memcpy"]);
    view.set([1, 2, 3, 4], 100);
    const memcpy = hostFunction(env, "memcpy");
    expect(memcpy(200, 100, 4)).toBe(200);
    expect([...view.subarray(200, 204)]).toEqual([1, 2, 3, 4]);
  });

  test("memmove handles overlapping ranges and returns dst", () => {
    const { env, view } = biosWithMemory(["memmove"]);
    view.set([1, 2, 3, 4, 5], 100);
    const memmove = hostFunction(env, "memmove");
    expect(memmove(102, 100, 5)).toBe(102);
    expect([...view.subarray(102, 107)]).toEqual([1, 2, 3, 4, 5]);
  });

  test("memset fills bytes (truncated to u8) and returns dst", () => {
    const { env, view } = biosWithMemory(["memset"]);
    const memset = hostFunction(env, "memset");
    expect(memset(50, 0x1_ab, 3)).toBe(50);
    expect([...view.subarray(49, 54)]).toEqual([0, 0xab, 0xab, 0xab, 0]);
  });

  test("memcmp returns 0 for equal and byte difference for unequal", () => {
    const { env, view } = biosWithMemory(["memcmp"]);
    view.set([9, 9, 9], 10);
    view.set([9, 9, 9], 20);
    const memcmp = hostFunction(env, "memcmp");
    expect(memcmp(10, 20, 3)).toBe(0);
    view[21] = 7;
    expect(memcmp(10, 20, 3)).toBe(2);
    expect(memcmp(20, 10, 3)).toBe(-2);
  });
});

describe("bios import validation", () => {
  test("known imports (implemented + no-op) are accepted", () => {
    const bios = createBios();
    const module = moduleWithEnvImports([
      "CpuSet",
      "memcpy",
      "ArcTan2",
      "GameCubeMultiBoot_Init",
    ]);
    expect(Object.keys(bios.imports(module).env ?? {})).toHaveLength(4);
  });

  test("unknown imports fail at instantiation time, not silently at runtime", () => {
    const bios = createBios();
    const module = moduleWithEnvImports(["strlen"]);
    expect(() => bios.imports(module)).toThrow(
      /unimplemented host function: strlen/,
    );
  });

  test("imports from a non-env namespace fail fast, even for known names", () => {
    const bios = createBios();
    // `memcpy` is implemented on env, but a wasi-namespaced import can't be
    // satisfied by bios — the engine expects wasi_snapshot_preview1.memcpy.
    const module = moduleWithImports("wasi_snapshot_preview1", ["memcpy"]);
    expect(() => bios.imports(module)).toThrow(
      /unexpected namespace "wasi_snapshot_preview1"/,
    );
  });
});
