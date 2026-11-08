import { expect, test } from "bun:test";
import { ownLatestStaticBytes } from "./latest-static-bytes.mjs";

test("browser ArrayBuffer inputs become independent Uint8Array asset bytes", () => {
  const source = new Uint8Array([3, 4, 5]);
  const result = ownLatestStaticBytes(source.buffer);
  expect(result).toBeInstanceOf(Uint8Array);
  expect([...result]).toEqual([3, 4, 5]);
  source[0] = 9;
  expect(result[0]).toBe(3);
  result[1] = 8;
  expect(source[1]).toBe(4);
});

test("typed byte views retain exactly their span and independent ownership", () => {
  const source = new Uint8Array([9, 3, 4, 8]);
  const result = ownLatestStaticBytes(source.subarray(1, 3));
  expect([...result]).toEqual([3, 4]);
  source[1] = 7;
  expect(result[0]).toBe(3);
  expect(result.buffer.byteLength).toBe(2);
});

test("unknown containers and detached buffers fail without byte coercion", () => {
  for (const value of [
    null,
    undefined,
    [1, 2],
    "data",
    {},
    new Uint16Array([1]),
  ])
    expect(() => ownLatestStaticBytes(value)).toThrow(
      "ArrayBuffer or Uint8Array",
    );
  const detached = new ArrayBuffer(4);
  structuredClone(detached, { transfer: [detached] });
  expect(() => ownLatestStaticBytes(detached)).toThrow();
});
