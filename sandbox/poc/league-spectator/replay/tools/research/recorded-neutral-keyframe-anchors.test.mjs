import { expect, test } from "bun:test";
import { createNeutralKeyframeAnchorCollector } from "./recorded-neutral-keyframe-anchors.mjs";

const actor = {
  context: 17,
  objectName: "SRU_Horde.12.1",
  creationTimeSeconds: 5,
  killTimeSeconds: 50,
  observations: [{ timeSeconds: 15 }],
};
const point = [23, -55];
const route = {
  entityId: actor.context,
  encodedWaypoints: [point],
  speed: 350,
};
const creation = {
  stream: 2,
  chunkOffset: 100,
  timeSeconds: 10,
  secondTimeBits: 22,
  explicitOpcode: 392,
  paramBits: actor.context,
  marker: 0,
  payload: new TextEncoder().encode(actor.objectName),
};
const position = {
  ...creation,
  explicitOpcode: 96,
  paramBits: 0,
  payload: new Uint8Array(1),
};

function collect(packets, records = [route]) {
  const collector = createNeutralKeyframeAnchorCollector(
    (body) => new TextDecoder().decode(body),
    () => ({ records, syncId: 13 }),
  );
  for (const packet of packets) collector.observe(packet);
  return collector.finish([actor], 60);
}

test("emits a stationary anchor from an exact matching checkpoint", () => {
  expect(collect([creation, position])).toEqual([
    {
      context: actor.context,
      observations: [
        {
          timeSeconds: 10,
          secondTimeBits: 22,
          opcode: 96,
          syncId: 13,
          speed: 350,
          encodedWaypoints: [point],
        },
      ],
    },
  ]);
});

test("omits unmatched, ambiguous, and moving checkpoint records", () => {
  for (const packets of [
    [position],
    [creation, creation, position],
    [creation, position, position],
    [{ ...creation, stream: 1 }, position],
    [{ ...creation, chunkOffset: 99 }, position],
    [{ ...creation, secondTimeBits: 23 }, position],
    [{ ...creation, timeSeconds: 9 }, position],
    [
      { ...creation, payload: new TextEncoder().encode("SRU_Horde.12.2") },
      position,
    ],
  ]) {
    expect(collect(packets)).toEqual([]);
  }
  expect(
    collect(
      [creation, position],
      [{ ...route, encodedWaypoints: [point, [1, 1]] }],
    ),
  ).toEqual([]);
});

test("omits frames outside lifecycle and at ordinary route clocks", () => {
  for (const timeSeconds of [5, 15, 50]) {
    expect(
      collect([
        { ...creation, timeSeconds },
        { ...position, timeSeconds },
      ]),
    ).toEqual([]);
  }
});
