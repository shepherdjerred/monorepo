import { expect, test } from "bun:test";
import {
  readRecordedRiftEffectPackets,
  selectRecordedRiftEffectPackets,
} from "./recorded-rift-effect-packets.mjs";
import { bindRecordedRiftEffectReceipt } from "./recorded-rift-effect-receipts.mjs";

test("keeps creation and stop packets in physical order with inherited headers", () => {
  const payload = Uint8Array.of(9);
  const packet = {
    stream: 1,
    marker: 0,
    timeSeconds: 4,
    payload,
  };
  const selected = [
    ...selectRecordedRiftEffectPackets([
      {
        ...packet,
        stream: 2,
        blockOffset: 0,
        explicitOpcode: 938,
        paramBits: 200,
      },
      { ...packet, blockOffset: 0, explicitOpcode: 66, paramBits: 100 },
      {
        ...packet,
        blockOffset: 10,
        explicitOpcode: 938,
        marker: 32,
        paramBits: 3,
      },
      { ...packet, blockOffset: 20, marker: 32, paramBits: 255 },
      {
        ...packet,
        blockOffset: 30,
        explicitOpcode: 1164,
        marker: 32,
        paramBits: 1,
      },
      { ...packet, blockOffset: 0, paramBits: 90 },
    ]),
  ];
  expect(selected).toEqual([
    {
      kind: "create",
      opcode: 938,
      sequence: 2,
      context: 103,
      timeSeconds: 4,
      payload,
    },
    {
      kind: "create",
      opcode: 938,
      sequence: 3,
      context: 102,
      timeSeconds: 4,
      payload,
    },
    {
      kind: "stop",
      opcode: 1164,
      sequence: 4,
      context: 103,
      timeSeconds: 4,
      payload,
    },
  ]);
});

test("rejects unreviewed builds and protocols before scanning packets", () => {
  for (const header of [
    { build: "16.23.840.6595", protocol: "8bbfcd5af2bc92db" },
    { build: "16.23.841.8428", protocol: "0000000000000000" },
  ])
    expect(() => readRecordedRiftEffectPackets(header, () => {})).toThrow(
      "Recorded particle packet build or protocol differs",
    );
});

test("binds stop requests by physical packet, not by shared time or context", () => {
  const body = { sequence: 8, context: 0, packetSha256: "a".repeat(64) };
  const stop = { ...body, stamp: 4, target: 12, route: "alternate-stop" };
  const packets = [
    { ...body, kind: "create", timeSeconds: 4 },
    { ...body, kind: "stop", timeSeconds: 4, sequence: 9 },
  ];
  expect(() =>
    bindRecordedRiftEffectReceipt(packets, { events: [stop] }, "stop"),
  ).toThrow("Recorded effect stop packet provenance differs");
  expect(
    bindRecordedRiftEffectReceipt(
      packets,
      { events: [{ ...stop, sequence: 9 }] },
      "stop",
    ),
  ).toEqual([{ ...stop, sequence: 9, kind: "stop" }]);
});

test("orders create groups by wire sequence and preserves packet entry order", () => {
  const body = { context: 0, packetSha256: "b".repeat(64) };
  const packets = [5, 6].map((sequence) => ({
    ...body,
    sequence,
    kind: "create",
    timeSeconds: 4,
  }));
  const events = [
    { ...body, sequence: 6, stamp: 4, handle: 10 },
    { ...body, sequence: 5, stamp: 4, handle: 20 },
    { ...body, sequence: 5, stamp: 4, handle: 30 },
  ];
  const result = bindRecordedRiftEffectReceipt(
    packets,
    { events, packetCount: 2 },
    "create",
    [4, 5],
  );
  expect(result.map(({ handle }) => handle)).toEqual([20, 30, 10]);
  expect(() =>
    bindRecordedRiftEffectReceipt(
      packets,
      { events, packetCount: 2 },
      "create",
      [3, 4],
    ),
  ).toThrow("Effect create packet count differs");
});
