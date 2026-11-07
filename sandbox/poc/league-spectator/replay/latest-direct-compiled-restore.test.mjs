import { test, expect } from "bun:test";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
  directInitializationBufferStats,
  restoreLatestDirectCompiledDefinitions,
} from "./latest-direct-compiled-restore.mjs";
test("compiled equality preserves signed zero, typed lanes and own fields", () => {
  const a = { position: [-0, 1], packed: new Uint16Array([0x8000, 0x3c00]) };
  expect(() => assertDirectCompiledDataGraph(a)).not.toThrow();
  expect(sameDirectCompiledData(a, structuredClone(a))).toBe(true);
  const sign = structuredClone(a);
  sign.position[0] = 0;
  expect(sameDirectCompiledData(a, sign)).toBe(false);
  const lane = structuredClone(a);
  lane.packed[0] = 0;
  expect(sameDirectCompiledData(a, lane)).toBe(false);
  expect(sameDirectCompiledData(a, { ...a, extra: undefined })).toBe(false);
  expect(
    sameDirectCompiledData(new Float32Array([-0]), new Float32Array([0])),
  ).toBe(false);
  expect(
    sameDirectCompiledData(new Uint16Array([1]), new Int16Array([1])),
  ).toBe(false);
});
test("compiled graphs reject accessors, prototypes and serialization hooks without invoking them", () => {
  let invoked = false;
  const getter = {};
  Object.defineProperty(getter, "value", {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    },
  });
  const hook = {
    toJSON() {
      invoked = true;
      return {};
    },
  };
  const constructorGetter = new Uint16Array([1]),
    bufferGetter = new Uint8Array([1]),
    prototypeGetter = new Uint16Array([1]);
  for (const [value, key] of [
    [constructorGetter, "constructor"],
    [bufferGetter, "buffer"],
  ])
    Object.defineProperty(value, key, {
      get() {
        invoked = true;
        return Uint16Array;
      },
    });
  const prototype = {};
  Object.defineProperty(prototype, "constructor", {
    get() {
      invoked = true;
      return Uint16Array;
    },
  });
  Object.setPrototypeOf(prototypeGetter, prototype);
  for (const value of [
    getter,
    hook,
    constructorGetter,
    bufferGetter,
    prototypeGetter,
    Object.create({ value: 1 }),
    Object.assign(Object.create({}), { own: 1 }),
    Object.assign([1], { extra: 1 }),
    [1, , 3],
    Object.setPrototypeOf([1], {}),
    Object.setPrototypeOf(new Uint16Array([1]), { constructor: Uint16Array }),
  ])
    expect(() => assertDirectCompiledDataGraph(value)).toThrow();
  expect(invoked).toBe(false);
  expect(sameDirectCompiledData(getter, { value: 1 })).toBe(false);
  expect(invoked).toBe(false);
});
test("compiled graph sharing is allowed but cycles and non-data scalars fail", () => {
  const shared = { value: 1 };
  expect(() => assertDirectCompiledDataGraph([shared, shared])).not.toThrow();
  const cycle = {};
  cycle.self = cycle;
  for (const v of [cycle, Infinity, NaN, () => 1, Symbol("value"), 1n])
    expect(() => assertDirectCompiledDataGraph(v)).toThrow();
});
test("initialization buffer accounting counts distinct storage separately from views", () => {
  const b = new ArrayBuffer(16),
    a = new Uint8Array(b),
    c = new Uint16Array(b, 4, 2);
  expect(directInitializationBufferStats({ a, c, b, again: a })).toEqual({
    uniqueBuffers: 1,
    uniqueBufferBytes: 16,
    referencedViewBytes: 20,
    wireBytes: null,
  });
});
test("compiled byte comparisons preserve source buffers, spans and signed-zero lanes", () => {
  const a = new Float32Array([-0, 1, 2, 3]),
    b = new Float32Array([-0, 1, 2, 3]),
    beforeA = a.slice(),
    beforeB = b.slice();
  expect(sameDirectCompiledData(a.subarray(1, 3), b.subarray(1, 3))).toBe(true);
  expect(sameDirectCompiledData(a.buffer, b.buffer)).toBe(true);
  b[0] = 0;
  expect(sameDirectCompiledData(a, b)).toBe(false);
  expect(sameDirectCompiledData(a.buffer, b.buffer)).toBe(false);
  b[0] = -0;
  expect(a).toEqual(beforeA);
  expect(b).toEqual(beforeB);
  expect(a.buffer.byteLength).toBe(16);
  expect(b.buffer.byteLength).toBe(16);
});
test("worker compiler restore requires explicit complete input and ordered inventory", async () => {
  await expect(
    restoreLatestDirectCompiledDefinitions({
      compilationMode: "guess",
      definitions: [],
    }),
  ).rejects.toThrow("Explicit supported compilation mode");
  await expect(
    restoreLatestDirectCompiledDefinitions({
      definitions: [],
      events: [],
      packages: {},
    }),
  ).rejects.toThrow("Complete captured compiler inputs");
  await expect(
    restoreLatestDirectCompiledDefinitions({
      definitions: [],
      events: [{ definitionId: "missing" }],
      packages: { compilationInputs: [] },
    }),
  ).rejects.toThrow("inventory differs from ordered events");
});
