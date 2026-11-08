import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { sha256 } from "../structural-comparison.mjs";

// Refresh provenance in an older comparison fixture from the ORIGINAL hash-
// checked replay. Decoded payload values are preserved; semantic sequence
// numbers are never substituted for transport order.
export async function withDirectPresentationOrdinals(
  report,
  replayBytes,
  decompress,
) {
  if ((await sha256(replayBytes)) !== report.replaySha256)
    throw Error("Presentation fixture replay hash differs");
  const replay = openReplay(
    replayBytes.buffer.slice(
      replayBytes.byteOffset,
      replayBytes.byteOffset + replayBytes.byteLength,
    ),
  );
  if (replay.build !== report.build || replay.protocol !== report.protocol)
    throw Error("Presentation fixture build differs");
  const groups = [
    "missiles",
    "missileEvents",
    "attacks",
    "casts",
    "movement",
    "lifecycle",
    "worldEvents",
  ];
  const wanted = new Map();
  const records = groups.flatMap((group) => {
    if (!Array.isArray(report[group]))
      throw Error(`Missing decoded presentation group: ${group}`);
    return report[group];
  });
  for (const record of [
    ...records,
    ...report.heroes.map((hero) => ({
      ...hero.provenance,
      stream: 2,
      expectedOpcode: 1049,
    })),
  ]) {
    const stream = record.stream ?? 1; // Original non-startup movement/combat/lifecycle decoders admit stream 1 only.
    const key = `${stream}:${record.chunkId}:${record.blockOffset}`;
    if (!wanted.has(key)) wanted.set(key, []);
    wanted.get(key).push(record);
  }
  const ordinals = new Map();
  let ordinal = 0;
  for (const chunk of replayChunks(replay, decompress)) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const key = `${chunk.stream}:${chunk.chunkId}:${block.blockOffset}`;
      if (wanted.has(key)) {
        if (
          ordinals.has(key) ||
          wanted
            .get(key)
            .some(
              (r) =>
                r.time !== block.time ||
                (r.expectedOpcode !== undefined &&
                  r.expectedOpcode !== block.opcode),
            )
        )
          throw Error("Presentation fixture packet identity/time differs");
        ordinals.set(key, ordinal);
      }
      ordinal++;
    }
  }
  const copyWithOrdinal = (record, stream = record.stream ?? 1) => {
    const key = `${stream}:${record.chunkId}:${record.blockOffset}`;
    if (!ordinals.has(key))
      throw Error(
        "Presentation fixture packet not found in original transport",
      );
    const transportSequence = ordinals.get(key);
    if (
      record.transportSequence !== undefined &&
      record.transportSequence !== transportSequence
    )
      throw Error("Cached presentation ordinal disagrees with original replay");
    return { ...record, transportSequence };
  };
  return {
    ...report,
    heroes: report.heroes.map((hero) => ({
      ...hero,
      provenance: copyWithOrdinal(hero.provenance, 2),
    })),
    ...Object.fromEntries(
      groups.map((group) => [
        group,
        report[group].map((record) => copyWithOrdinal(record)),
      ]),
    ),
  };
}
