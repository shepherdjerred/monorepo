import { expect, test } from "bun:test";
import { copyDirectPrivateCheckpoint } from "./direct-private-checkpoint-copy.mjs";
import { freezeDirectOwnedData } from "../latest-direct-immutable-data.mjs";

test("private checkpoints borrow certified immutable graphs and detach complete mutable aliases/cycles", () => {
  const descriptor = { raw: "ab".repeat(65536), source: { order: [1, 2, 3] } };
  descriptor.self = descriptor;
  freezeDirectOwnedData(descriptor);
  const reasons = ["original"],
    row = { reasons, descriptor },
    event = { reasons, descriptor };
  const input = {
    changes: [["row", row]],
    payload: {
      instances: [{ event }],
      map: new Map([[row, event]]),
      set: new Set([row, event]),
    },
  };
  input.payload.owner = input;
  const cloned = copyDirectPrivateCheckpoint(input);
  expect(cloned).toEqual(structuredClone(input));
  expect(cloned).not.toBe(input);
  expect(cloned.payload.owner).toBe(cloned);
  const copiedRow = cloned.changes[0][1],
    copiedEvent = cloned.payload.instances[0].event;
  expect(copiedRow.reasons).toBe(copiedEvent.reasons);
  expect(copiedRow.reasons).not.toBe(reasons);
  expect(cloned.payload.map.get(copiedRow)).toBe(copiedEvent);
  expect(cloned.payload.set.has(copiedEvent)).toBe(true);
  expect(copiedEvent.descriptor).toBe(descriptor);
  expect(copiedRow.descriptor.self).toBe(descriptor);
  reasons.push("later");
  expect(copiedRow.reasons).toEqual(["original"]);
  copiedEvent.reasons.push("checkpoint-only");
  expect(reasons).toEqual(["original", "later"]);
  const publicCopy = structuredClone(cloned);
  expect(publicCopy.changes[0][1].descriptor).not.toBe(descriptor);
  publicCopy.changes[0][1].descriptor.source.order[0] = 999;
  expect(descriptor.source.order[0]).toBe(1);
});

test("all supported backing views preserve offsets and shared buffers while detaching source memory", () => {
  const buffer = new ArrayBuffer(128),
    bytes = new Uint8Array(buffer),
    views = [
      new Int8Array(buffer, 1, 7),
      new Uint8Array(buffer, 2, 8),
      new Uint8ClampedArray(buffer, 3, 7),
      new Int16Array(buffer, 4, 8),
      new Uint16Array(buffer, 6, 8),
      new Int32Array(buffer, 8, 8),
      new Uint32Array(buffer, 12, 8),
      new Float32Array(buffer, 16, 8),
      new Float64Array(buffer, 24, 8),
      new BigInt64Array(buffer, 32, 8),
      new BigUint64Array(buffer, 40, 8),
      new DataView(buffer, 3, 33),
    ];
  bytes.forEach((_, index) => {
    bytes[index] = index;
  });
  const frozenWrapper = Object.freeze({ views, buffer });
  const copied = copyDirectPrivateCheckpoint({
    frozenWrapper,
    aliases: views,
    again: views[0],
  });
  expect(copied).toEqual(
    structuredClone({ frozenWrapper, aliases: views, again: views[0] }),
  );
  expect(copied.frozenWrapper).not.toBe(frozenWrapper);
  expect(copied.aliases).toBe(copied.frozenWrapper.views);
  expect(copied.again).toBe(copied.aliases[0]);
  expect(copied.frozenWrapper.buffer).not.toBe(buffer);
  for (let index = 0; index < views.length; index++) {
    expect(copied.aliases[index].buffer).toBe(copied.frozenWrapper.buffer);
    expect(copied.aliases[index].byteOffset).toBe(views[index].byteOffset);
    expect(copied.aliases[index].byteLength).toBe(views[index].byteLength);
  }
  bytes[0] = 255;
  expect(new Uint8Array(copied.frozenWrapper.buffer)[0]).toBe(0);
});

test("sparse arrays and own proto-named data retain structured-clone shape without sharing mutable owners", () => {
  const array = new Array(5),
    object = Object.create(null);
  array[3] = -0;
  array.note = object;
  object.owner = array;
  Object.defineProperty(object, "__proto__", {
    value: { safe: true },
    enumerable: true,
  });
  const copied = copyDirectPrivateCheckpoint(array);
  expect(copied).toEqual(structuredClone(array));
  expect(0 in copied).toBe(false);
  expect(3 in copied).toBe(true);
  expect(Object.is(copied[3], -0)).toBe(true);
  expect(copied.note.owner).toBe(copied);
  expect(Object.getPrototypeOf(copied.note)).toBe(Object.prototype);
  expect(Object.hasOwn(copied.note, "__proto__")).toBe(true);
  expect(copied.note.__proto__).not.toBe(object.__proto__);
});

test("unbound private checkpoint objects and executable values fail instead of gaining a cloning fallback", () => {
  class Foreign {}
  for (const value of [
    new Foreign(),
    Object.freeze(new Foreign()),
    new Date(),
    /unknown/,
    () => {},
    Symbol("unknown"),
  ])
    expect(() => copyDirectPrivateCheckpoint({ value })).toThrow(
      "Unsupported private checkpoint",
    );
});
