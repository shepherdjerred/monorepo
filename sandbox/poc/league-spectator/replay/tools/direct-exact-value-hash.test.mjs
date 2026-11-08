import { test, expect } from "bun:test";
import { directExactValueHash as hash } from "./direct-exact-value-hash.mjs";
test("exact state hashes preserve scalar sign, attribute type/bytes and full own metadata", () => {
  expect(hash(-0)).not.toBe(hash(0));
  expect(hash(new Float32Array([-0]))).not.toBe(hash(new Float32Array([0])));
  expect(hash(new Uint16Array([1]))).not.toBe(hash(new Int16Array([1])));
  expect(hash({ x: undefined })).not.toBe(hash({}));
  expect(hash([1, 2])).not.toBe(hash({ 0: 1, 1: 2 }));
  expect(hash("number:1")).not.toBe(hash(1));
  expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 }));
});
test("exact hash streaming boundaries do not change content or mutate arrays", () => {
  const value = {
      x: new Float32Array([-0, 1, 2]),
      y: Array.from({ length: 1000 }, (_, i) => ({
        id: `row:${i}`,
        time: i / 60,
      })),
    },
    before = structuredClone(value);
  expect(hash(value, 17)).toBe(hash(value, 65536));
  expect(value).toEqual(before);
});
test("exact hash rejects unsupported graphs and never invokes accessors", () => {
  let invoked = false;
  const v = {};
  Object.defineProperty(v, "x", {
    get() {
      invoked = true;
      return 1;
    },
  });
  expect(() => hash(v)).toThrow();
  expect(invoked).toBe(false);
  const array = [1],
    typed = new Float32Array([1]);
  Object.defineProperty(array, "0", {
    get() {
      invoked = true;
      return 1;
    },
  });
  Object.defineProperty(typed, "constructor", {
    get() {
      invoked = true;
      return Float32Array;
    },
  });
  expect(() => hash(array)).toThrow();
  expect(() => hash(typed)).toThrow();
  expect(invoked).toBe(false);
  expect(() => hash([, 1])).toThrow();
  const cycle = {};
  cycle.self = cycle;
  expect(() => hash(cycle)).toThrow();
});
