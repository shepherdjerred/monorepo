import { expect, test } from "bun:test";
import { compareCheckpointStateParts } from "./checkpoint-state-comparison.mjs";

const state = () => ({
  header: {
    time: 3022.7,
    tick: 181362,
    cursor: 307256,
    ledger: [],
    generations: [],
    reasonBindings: [[0, ["native-source"]]],
    instances: [
      ["active", { random: [1, 2, 3], pool: new Float32Array([1, -0]) }],
    ],
    counts: { decoded: 307256 },
  },
  ledger: new Map([
    ["first", { sourceEventId: "create:0", reasons: ["known omission"] }],
    ["last", { sourceEventId: "create:1", generation: 2, dead: true }],
  ]),
  generations: new Map([
    [100, 1],
    [200, 2],
  ]),
});

test("streamed comparison checks every header and ordered collection field", () => {
  const before = state();
  expect(compareCheckpointStateParts(before, structuredClone(before))).toEqual({
    ledger: 2,
    generations: 2,
  });
  for (const change of [
    (s) => {
      s.header.cursor--;
    },
    (s) => {
      s.header.instances[0][1].random[1]++;
    },
    (s) => {
      s.header.instances[0][1].pool[1] = 0;
    },
    (s) => {
      s.header.reasonBindings[0][1][0] = "different";
    },
    (s) => {
      s.header.futureField = true;
    },
    (s) => {
      s.ledger.get("first").reasons.push("changed");
    },
    (s) => {
      s.ledger.get("last").generation++;
    },
    (s) => {
      s.ledger.delete("first");
    },
    (s) => {
      const row = s.ledger.get("first");
      s.ledger.delete("first");
      s.ledger.set("first", row);
    },
    (s) => {
      s.generations.set(200, 3);
    },
    (s) => {
      s.generations = new Map([
        [200, 2],
        [100, 1],
      ]);
    },
  ]) {
    const changed = structuredClone(before);
    change(changed);
    expect(() => compareCheckpointStateParts(before, changed)).toThrow();
  }
});

test("whole-count insertion-order histories compare without a whole-graph pair memo", () => {
  const left = state(),
    right = structuredClone(left);
  left.ledger.clear();
  right.ledger.clear();
  const metadata = {
    provenance: ["original", "native"],
    words: new Uint32Array([1, 2, 3]),
  };
  const otherMetadata = structuredClone(metadata);
  for (let i = 0; i < 307256; i++) {
    left.ledger.set(i, { time: i / 100, metadata });
    right.ledger.set(i, { time: i / 100, metadata: otherMetadata });
  }
  expect(compareCheckpointStateParts(left, right).ledger).toBe(307256);
  right.ledger.get(307255).time++;
  expect(() => compareCheckpointStateParts(left, right)).toThrow("307255");
});
