// Read-only inspection of an installed executable and one replay; no game launch.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectTransport } from "../transport.mjs";
import { inspectExecutable } from "./pe.mjs";

const [installation, replayPath, vendorPath, outputPath] =
  process.argv.slice(2);
if (!installation || !replayPath || !vendorPath || !outputPath)
  throw Error(
    "Usage: bun tools/inspect-local.mjs <League-installation> <replay.rofl> <fzstd.mjs> <report.json>",
  );
const executable = await readFile(
  resolve(installation, "Game/League of Legends.exe"),
);
const pe = inspectExecutable(executable);
const { decompress } = await import(pathToFileURL(resolve(vendorPath)).href);
const bytes = await readFile(replayPath);
const samples = {},
  initialSamples = {};
const packetDigest = createHash("sha256");
const frame = Buffer.alloc(19);
const transport = inspectTransport(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  decompress,
  (block) => {
    frame.writeUInt8(block.stream, 0);
    frame.writeDoubleLE(block.time, 1);
    frame.writeUInt16LE(block.opcode, 9);
    frame.writeUInt32LE(block.param, 11);
    frame.writeUInt32LE(block.payload.length, 15);
    packetDigest.update(frame).update(block.payload);
    const target = block.stream === 1 ? samples : initialSamples;
    if (block.stream === 2 && block.time !== 0) return;
    if (!target[block.opcode])
      target[block.opcode] = {
        time: block.time,
        param: block.param,
        chunkId: block.chunkId,
        blockOffset: block.blockOffset,
        payloadHex: Buffer.from(block.payload).toString("hex"),
      };
  },
);
const marker = (await readFile(resolve(installation, "Game.ok"), "utf8"))
  .trim()
  .split(/\r?\n/);
const report = {
  schema: 1,
  executable: {
    sha256: createHash("sha256").update(executable).digest("hex"),
    bytes: executable.length,
    ...pe,
  },
  content: {
    installedManifest: marker[0],
    locale: marker[1],
    platform: marker[2],
  },
  replay: {
    file: resolve(replayPath),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    ...transport,
    packetDigest: packetDigest.digest("hex"),
  },
  packetSamples: samples,
  initialPacketSamples: initialSamples,
  compatibility: {
    executableMatchesReplay: pe.version === transport.build,
    gameplayDecoderAvailable: false,
  },
};
await Bun.write(outputPath, JSON.stringify(report, null, 2));
const { opcodes, ...summary } = report.replay;
console.log(
  JSON.stringify(
    {
      executable: {
        ...report.executable,
        sections: report.executable.sections.map(({ name, entropy }) => ({
          name,
          entropy: Number(entropy.toFixed(3)),
        })),
      },
      content: report.content,
      replay: summary,
      compatibility: report.compatibility,
      samples: Object.keys(samples).length,
      initialSamples: Object.keys(initialSamples).length,
      output: resolve(outputPath),
    },
    null,
    2,
  ),
);
