import assert from "node:assert/strict";

// The archive decoder owns semantic fields. A packet can contribute multiple
// create entries, so match each ordered receipt row to its physical packet.
export function bindRecordedRiftEffectReceipt(
  packets,
  receipt,
  kind,
  [start, end] = [0, Infinity],
) {
  assert.ok(kind === "create" || kind === "stop");
  assert.ok(Number.isFinite(start) && start >= 0 && end > start);
  const bySequence = new Map();
  for (const packet of packets) {
    if (
      packet.kind === kind &&
      packet.timeSeconds >= start &&
      packet.timeSeconds < end
    )
      bySequence.set(packet.sequence, packet);
  }
  if (kind === "create" || receipt.packetCount !== undefined)
    assert.equal(
      bySequence.size,
      receipt.packetCount,
      `Effect ${kind} packet count differs`,
    );

  return receipt.events
    .map((event) => {
      const packet = bySequence.get(event.sequence);
      assert.ok(
        packet !== undefined &&
          packet.timeSeconds === event.stamp &&
          packet.context === event.context &&
          packet.packetSha256 === event.packetSha256,
        `Recorded effect ${kind} packet provenance differs`,
      );
      return { ...event, kind };
    })
    .sort((left, right) => left.sequence - right.sequence);
}
