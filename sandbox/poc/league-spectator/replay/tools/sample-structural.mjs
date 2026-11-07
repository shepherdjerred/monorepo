// Deterministic coverage samples from both gameplay and snapshot streams.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [
  replayPath,
  profilePath,
  vendorPath,
  outputPath,
  windowEnd,
  gameplayOpcodes,
  initialOpcodes,
] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun tools/sample-structural.mjs <replay.rofl> <profile.json> <fzstd.mjs> <output.json> [semantic-end-seconds | --reservoir=size:opcodes-csv] [gameplay-opcodes-csv] [initial-snapshot-opcodes-csv]",
  );
const bytes = await Bun.file(replayPath).arrayBuffer();
const replay = openReplay(bytes),
  profile = await Bun.file(profilePath).json();
if (
  replay.build !== profile.clientVersion ||
  replay.protocol !== profile.protocolDigest
)
  throw Error("Replay does not match the exact decoder build/protocol");
const { decompress } = await import(pathToFileURL(resolve(vendorPath)));
const reservoirOption = windowEnd?.match(/^--reservoir=(\d+):(\d+(?:,\d+)*)$/),
  reservoirSize = reservoirOption ? Number(reservoirOption[1]) : 16,
  reservoirOpcodes = reservoirOption
    ? reservoirOption[2].split(",").map(Number)
    : null;
if (
  reservoirOption &&
  (reservoirSize < 1 ||
    reservoirSize > 4096 ||
    reservoirOpcodes.some(
      (v) => !Number.isInteger(v) || v < 0 || v > profile.maxOpcode,
    ))
)
  throw Error("Invalid reservoir size/opcode selection");
if (windowEnd !== undefined && !reservoirOption) {
  const endTime = Number(windowEnd),
    packets = {};
  const selectedOpcodes =
    gameplayOpcodes === undefined
      ? [657]
      : gameplayOpcodes.split(",").map(Number);
  const selectedInitialOpcodes =
    initialOpcodes === undefined
      ? [132, 1049]
      : initialOpcodes.split(",").map(Number);
  if (
    !selectedOpcodes.length ||
    [...selectedOpcodes, ...selectedInitialOpcodes].some(
      (v) => !Number.isInteger(v) || v < 0 || v > profile.maxOpcode,
    )
  )
    throw Error("Invalid selected opcodes");
  if (!Number.isFinite(endTime) || endTime < 0 || endTime > replay.duration)
    throw Error("Invalid semantic sample window");
  let count = 0;
  for (const chunk of replayChunks(replay, decompress)) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      if (
        !(
          chunk.stream === 2 &&
          block.time === 0 &&
          selectedInitialOpcodes.includes(block.opcode)
        ) &&
        !(
          chunk.stream === 1 &&
          block.time <= endTime &&
          selectedOpcodes.includes(block.opcode)
        )
      )
        continue;
      packets[`${chunk.stream}:${block.opcode}:${count++}`] = {
        opcode: block.opcode,
        stream: chunk.stream,
        time: block.time,
        param: block.param,
        chunkId: chunk.chunkId,
        blockOffset: block.blockOffset,
        payloadHex: Buffer.from(block.payload).toString("hex"),
      };
    }
  }
  await Bun.write(
    outputPath,
    JSON.stringify({
      schema: 1,
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: await sha256(bytes),
      selection: {
        kind: "initial-snapshot-and-selected-gameplay",
        endTime,
        gameplayOpcodes: selectedOpcodes,
        initialSnapshotOpcodes: selectedInitialOpcodes,
      },
      packets,
    }),
  );
  console.log(JSON.stringify({ samples: count, endTime }));
  process.exit(0);
}
const groups = new Map();
for (const chunk of replayChunks(replay, decompress)) {
  if (![1, 2].includes(chunk.stream)) continue;
  for (const block of replayBlocks(chunk)) {
    if (reservoirOpcodes && !reservoirOpcodes.includes(block.opcode)) continue;
    const key = `${block.stream}:${block.opcode}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        count: 0,
        state: (block.opcode + block.stream * 65537) >>> 0,
        reservoir: [],
        minimum: null,
        maximum: null,
      };
      groups.set(key, group);
    }
    group.count++;
    // Reservoir entries are independent of decoder acceptance and payload shape.
    group.state = (Math.imul(group.state, 1664525) + 1013904223) >>> 0;
    const slot = Math.floor((group.state / 2 ** 32) * group.count);
    const minimum =
      !group.minimum || block.payload.length < group.minimum.bytes;
    const maximum =
      !group.maximum || block.payload.length > group.maximum.bytes;
    if (
      group.reservoir.length < reservoirSize ||
      slot < reservoirSize ||
      minimum ||
      maximum
    ) {
      const sample = {
        opcode: block.opcode,
        stream: block.stream,
        time: block.time,
        param: block.param,
        chunkId: block.chunkId,
        blockOffset: block.blockOffset,
        bytes: block.payload.length,
        payloadHex: Buffer.from(block.payload).toString("hex"),
      };
      if (group.reservoir.length < reservoirSize) group.reservoir.push(sample);
      else if (slot < reservoirSize) group.reservoir[slot] = sample;
      if (minimum) group.minimum = sample;
      if (maximum) group.maximum = sample;
    }
  }
}
const packets = {},
  coverage = {};
for (const [key, group] of groups) {
  const unique = new Map(
    [...group.reservoir, group.minimum, group.maximum].map((s) => [
      `${s.chunkId}:${s.blockOffset}`,
      s,
    ]),
  );
  const selected = [...unique.values()].sort(
    (a, b) =>
      a.time - b.time || a.chunkId - b.chunkId || a.blockOffset - b.blockOffset,
  );
  for (let i = 0; i < selected.length; i++)
    packets[`${key}:${i}`] = selected[i];
  coverage[key] = {
    packets: group.count,
    selected: selected.length,
    minimumBytes: group.minimum.bytes,
    maximumBytes: group.maximum.bytes,
  };
}
const corpus = {
  schema: 1,
  build: replay.build,
  protocol: replay.protocol,
  replaySha256: await sha256(bytes),
  selection: `${reservoirSize} deterministic reservoir entries plus payload-size extrema per stream/opcode`,
  ...(reservoirOpcodes ? { selectedOpcodes: reservoirOpcodes } : {}),
  coverage,
  packets,
};
await Bun.write(outputPath, JSON.stringify(corpus));
console.log(
  JSON.stringify({
    build: corpus.build,
    groups: groups.size,
    samples: Object.keys(packets).length,
    gameplayTypes: Object.keys(coverage).filter((k) => k.startsWith("1:"))
      .length,
    snapshotTypes: Object.keys(coverage).filter((k) => k.startsWith("2:"))
      .length,
  }),
);
