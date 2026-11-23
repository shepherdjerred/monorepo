import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts";
import { createNativePositionSceneTrace } from "./research/native-position-scene.mjs";

const [replayFile, outputFile, ...receiptFiles] = process.argv.slice(2);
if (!replayFile || !outputFile || !receiptFiles.length)
  throw Error(
    "Usage: bun prepare-native-position-scene.mjs <replay.rofl> <private-output.json> <reference.json> [...reference.json]",
  );
const bytes = new Uint8Array(await readFile(replayFile));
const { packetReader, observations } = prepareReplayForSeek(
  bytes.buffer,
  (stored, target) =>
    zstdDecompressSync(stored, { maxOutputLength: target.length }),
);
const receiptBytes = await Promise.all(
  receiptFiles.map((file) => readFile(file)),
);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const identity = {
  replaySha256: sha256(bytes),
  build: packetReader.build,
  protocol: packetReader.protocol,
  durationMilliseconds: packetReader.durationMilliseconds,
  participantCount: observations.roster.length,
};
const result = createNativePositionSceneTrace(
  identity,
  observations,
  receiptBytes.map((data) => JSON.parse(data.toString("utf8"))),
);
await writeFile(
  outputFile,
  JSON.stringify(
    { ...result, receiptSha256: receiptBytes.map(sha256) },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    kind: result.kind,
    frames: result.trace.frames.length,
    capturedFrames: result.trace.frames.filter((frame) => frame.actors.length)
      .length,
    participants: result.trace.participants.length,
    traceSha256: sha256(JSON.stringify(result.trace)),
  }),
);
