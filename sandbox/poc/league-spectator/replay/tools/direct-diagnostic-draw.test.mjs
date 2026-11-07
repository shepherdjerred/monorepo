import { expect, test } from "bun:test";
import { directDiagnosticDraw } from "./direct-diagnostic-draw.mjs";
const draw = () => ({
  primitive: "static-mesh",
  sourceEventId: "event:1",
  generation: 2,
  definitionId: "example",
  emitterId: 3,
  particleCount: 1,
  meshRecords: new Uint8Array(176),
  indices: new Uint16Array(0),
});
test("diagnostic mesh serialization preserves records and never fabricates quad geometry", () => {
  const d = draw();
  d.meshRecords[0] = 17;
  const r = directDiagnosticDraw(d),
    json = JSON.parse(JSON.stringify(r));
  expect(json.geometry.meshRecordsHex).toBe(`11${"00".repeat(175)}`);
  expect(json.indices).toEqual([]);
  expect(json.sourceEventId).toBe(d.sourceEventId);
  for (const key of ["verticesHex", "indicesHex"])
    expect(Object.hasOwn(json.geometry, key)).toBe(false);
  for (const key of [
    "meshRecords",
    "positions",
    "colors",
    "uv",
    "particleUV",
    "vertexBytes",
  ])
    expect(Object.hasOwn(json, key)).toBe(false);
  d.meshRecords[0] = 42;
  expect(json.geometry.meshRecordsHex.startsWith("11")).toBe(true);
});
test("diagnostic mesh serialization rejects corrupt records and mixed primitive representations", () => {
  for (const mutate of [
    (d) => {
      d.meshRecords = new Uint8Array(175);
    },
    (d) => {
      d.particleCount = 0;
    },
    (d) => {
      d.indices = new Uint16Array([0]);
    },
    (d) => {
      d.positions = new Float32Array(12);
    },
  ]) {
    const d = draw();
    mutate(d);
    expect(() => directDiagnosticDraw(d)).toThrow();
  }
});
