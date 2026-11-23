import { expect, test } from "bun:test";
import {
  createReplayStructureObserver,
  ReplayStructureValidationError,
} from "./replay-structure-events.mjs";

const binding = { verified: [{ context: 30, footerRow: 1 }], unresolved: [31] };

function setup() {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    BARRACKS_KILLED: index === 0 ? "2" : "0",
  }));
  const bytes = Buffer.concat([
    Buffer.alloc(256),
    Buffer.from(JSON.stringify({ statsJson: JSON.stringify(rows) })),
    Buffer.alloc(4),
  ]);
  return createReplayStructureObserver({
    build: "16.23.840.6595",
    protocol: "8bbfcd5af2bc92db",
    end: 0,
    duration: 20,
    bytes,
  });
}

function observe(observer, context, timeSeconds, secondTimeBits, opcodes) {
  for (const [opcode, size] of opcodes)
    observer.observeGameplayPacket(
      { timeSeconds, secondTimeBits, payload: new Uint8Array(size) },
      opcode,
      context,
    );
}

const inhibition = [
  [47, 5],
  [947, 1],
  [172, 116],
  [760, 24],
];
const terminal = [
  [767, 0],
  [1140, 0],
  [622, 3],
  [767, 0],
  [1140, 0],
];

test("joins structure witnesses in clock order and preserves repeat inhibitor losses", () => {
  const observer = setup();
  observe(observer, 31, 1, 10, [[172, 116]]);
  observe(observer, 42, 2, 20, [[172, 116]]);
  observe(observer, 50, 5, 50, inhibition);
  observe(observer, 50, 10, 100, inhibition);
  observe(observer, 51, 16.26, 200, [
    [47, 2],
    [172, 116],
  ]);
  observe(observer, 0, 16.26, 200, terminal);
  expect(
    observer.finish(binding, [{ context: 42, secondTimeBits: 20 }]),
  ).toEqual([
    {
      kind: "inhibitor-destruction",
      context: 50,
      timeSeconds: 5,
      secondTimeBits: 50,
    },
    {
      kind: "inhibitor-destruction",
      context: 50,
      timeSeconds: 10,
      secondTimeBits: 100,
    },
    {
      kind: "match-ending-structure-loss",
      context: 51,
      timeSeconds: 16.26,
      secondTimeBits: 200,
    },
  ]);
});

test("rejects shifted terminal and inhibitor witness clocks", () => {
  const observer = setup();
  observe(observer, 50, 5, 50, inhibition);
  observe(observer, 52, 10, 100, inhibition);
  observe(observer, 51, 16.26, 200, [
    [47, 2],
    [172, 116],
  ]);
  observe(observer, 0, 16.26, 201, terminal);
  expect(() => observer.finish(binding, [])).toThrow(
    ReplayStructureValidationError,
  );

  const second = setup();
  observe(second, 50, 5, 50, inhibition.slice(0, -1));
  observe(second, 50, 5, 51, [[760, 24]]);
  expect(() => second.finish(binding, [])).toThrow(
    "Uncorroborated non-champion structure death",
  );
});
