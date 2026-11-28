import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createCurrentNexusEvidenceCollector } from "./native-terrain-nexus-worker.mjs";

const reader = {
  durationSeconds: 120,
  keyframes: [
    { chunkOffset: 100, timeSeconds: 0 },
    { chunkOffset: 200, timeSeconds: 60 },
  ],
};
const loss = { context: 11, timeSeconds: 90, secondTimeBits: 512 };
const instances = [
  { context: 10, position: [1, 2, 3] },
  { context: 11, position: [4, 5, 6] },
];
const marker = Uint8Array.of(0xbe, 0x71, 0xa6);
function snapshot(
  context,
  chunkOffset,
  payload = marker,
  explicitOpcode = 1012,
) {
  return {
    stream: 2,
    chunkOffset,
    paramBits: context,
    explicitOpcode,
    payload,
  };
}
const terminal = {
  stream: 1,
  explicitOpcode: 172,
  paramBits: loss.context,
  timeSeconds: loss.timeSeconds,
  secondTimeBits: loss.secondTimeBits,
  payload: new Uint8Array(116).fill(37),
};
function collector() {
  return createCurrentNexusEvidenceCollector(reader, loss, instances, () => ({
    x: 1,
    z: 3,
  }));
}
function observeSnapshots(reducer) {
  for (const { chunkOffset } of reader.keyframes)
    for (const { context } of instances)
      reducer.observe(snapshot(context, chunkOffset));
}

test("corroborates both indexed Nexus markers and digests the original terminal payload", async () => {
  const reducer = collector();
  observeSnapshots(reducer);
  reducer.observe(snapshot(10, 100, new Uint8Array(1), 944));
  reducer.observe(terminal);
  assert.deepEqual(await reducer.finish(), {
    context: loss.context,
    timeSeconds: loss.timeSeconds,
    payloadSha256: createHash("sha256").update(terminal.payload).digest("hex"),
  });
});

test("rejects missing or conflicting original Nexus evidence", async () => {
  const empty = collector();
  await assert.rejects(empty.finish(), /independent snapshot is absent/);
  const reducer = collector();
  observeSnapshots(reducer);
  assert.throws(
    () => reducer.observe(snapshot(10, 100)),
    /Duplicate Nexus snapshot/,
  );
  assert.throws(
    () => reducer.observe(snapshot(11, 100, new Uint8Array(1), 944)),
    /differs from authored placement/,
  );
  reducer.observe({ ...terminal, secondTimeBits: 511 });
  await assert.rejects(reducer.finish(), /terminal packet is absent/);
  reducer.observe(terminal);
  assert.throws(
    () => reducer.observe(terminal),
    /Duplicate recorded Nexus terminal/,
  );
  assert.throws(
    () => reducer.observe({ ...terminal, explicitOpcode: 669 }),
    /Unexpected current Nexus animation/,
  );
});
