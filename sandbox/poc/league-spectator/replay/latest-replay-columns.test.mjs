import { expect, test } from "bun:test";
import {
  packReplayRows,
  replayRows,
  replayRowAt,
  replayRowProjection,
  ownReplayRows,
  replayColumnTransfers,
} from "./latest-replay-columns.mjs";

test("columnar transport preserves row order, shape, all fields and numeric/string bits", () => {
  const rows = [
    {
      id: "a",
      time: -0,
      vector: [-0, 1.25],
      reason: null,
      visible: false,
      text: "\ud800",
    },
    {
      id: "b",
      time: 1553.143310546875,
      vector: [3, 4],
      reason: null,
      visible: true,
      text: "你好",
    },
    {
      id: "c",
      time: 2,
      alternate: { flags: [1, 2], metadata: { source: "original" } },
    },
  ];
  const packed = packReplayRows(rows);
  const cloned = structuredClone(packed, {
    transfer: replayColumnTransfers(packed),
  });
  expect([...replayRows(cloned)]).toEqual(rows);
  expect(Object.is(replayRowAt(cloned, 0).time, -0)).toBe(true);
  expect(Object.is(replayRowAt(cloned, 0).vector[0], -0)).toBe(true);
  expect(
    replayRowProjection(cloned, 2, ["id", "alternate", "time", "missing"]),
  ).toEqual(rows[2]);
});

test("owned rows and returned nested values cannot mutate another query", () => {
  const source = [{ id: "one", nested: { ids: [1, 2] } }];
  const owned = ownReplayRows(source);
  source[0].nested.ids[0] = 99;
  const first = replayRowAt(owned, 0);
  first.nested.ids[0] = 77;
  expect(replayRowAt(owned, 0).nested.ids).toEqual([1, 2]);
});

test("canonical lowercase hex and narrow integer columns preserve exact values", () => {
  const rows = [
    {
      hex: "0000ff",
      mixed: "AB00",
      odd: "abc",
      integer: 1,
      signed: -128,
      zero: -0,
    },
    {
      hex: "abcdef00",
      mixed: "ab00",
      odd: "def",
      integer: 65535,
      signed: 127,
      zero: 0,
    },
  ];
  const packed = packReplayRows(rows),
    fields = packed.groups[0].fields;
  expect(fields.find((field) => field.name === "hex").column.type).toBe("hex");
  expect(fields.find((field) => field.name === "mixed").column.type).toBe(
    "strings",
  );
  expect(fields.find((field) => field.name === "odd").column.type).toBe(
    "strings",
  );
  expect(
    fields.find((field) => field.name === "integer").column.data.type,
  ).toBe("Uint16Array");
  expect(fields.find((field) => field.name === "signed").column.data.type).toBe(
    "Int8Array",
  );
  expect(fields.find((field) => field.name === "zero").column.data.type).toBe(
    "Float64Array",
  );
  expect([...replayRows(structuredClone(packed))]).toEqual(rows);
});

test("corrupt column offsets, group references and dictionary references fail", () => {
  const source = packReplayRows([
    { id: "one", nested: [1] },
    { id: "two", nested: [2] },
  ]);
  const group = structuredClone(source);
  new Uint16Array(group.groupIds.buffer)[0] = 100;
  expect(() => replayRowAt(group, 0)).toThrow("column group");
  const strings = structuredClone(source);
  new Uint32Array(
    strings.groups[0].fields.find((field) => field.name === "id").column.offsets
      .buffer,
  )[1] = 999;
  expect(() => replayRowAt(strings, 0)).toThrow("string storage");
  const dictionary = structuredClone(source);
  new Uint32Array(
    dictionary.groups[0].fields.find((field) => field.name === "nested").column
      .indices.buffer,
  )[0] = 999;
  expect(() => replayRowAt(dictionary, 0)).toThrow("dictionary storage");
});

test("binary envelopes reject incorrect element types and out-of-buffer spans", () => {
  const source = packReplayRows([{ n: 1 }, { n: 2 }]);
  for (const change of [
    { type: "BigUint64Array" },
    { byteOffset: -1 },
    { byteOffset: 1 },
    { length: 1000000 },
  ]) {
    const corrupted = structuredClone(source);
    Object.assign(corrupted.groupIds, change);
    expect(() => replayRowAt(corrupted, 0)).toThrow("envelope");
  }
});

test("repeated fields use bounded transferable columns rather than repeated row metadata", () => {
  const source = Array.from({ length: 10000 }, (_, index) => ({
    entityId: index,
    time: index / 60,
    status: "raw-target-visibility-mask-request",
    source: "network",
    visible: null,
    omissions: ["owner-callback-unresolved"],
  }));
  const packed = packReplayRows(source),
    buffers = replayColumnTransfers(packed);
  const bytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  expect(bytes).toBeLessThan(
    new TextEncoder().encode(JSON.stringify(source)).byteLength / 2,
  );
  expect([...replayRows(packed)]).toEqual(source);
});
