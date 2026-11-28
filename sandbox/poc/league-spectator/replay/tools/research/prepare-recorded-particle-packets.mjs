import { createHash } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { openReplay } from "../../transport.mjs";
import { readRecordedRiftEffectPackets } from "./recorded-rift-effect-packets.mjs";

// Keep the original replay and extracted packet bodies in the local authoring process.
const [path, flag, opcodeArgument, output, ...extra] = process.argv.slice(2);
const corpusFile =
  flag === "--opcode" &&
  (opcodeArgument === "938" || opcodeArgument === "1164") &&
  Boolean(output);
if (!path || extra.length !== 0 || (flag !== undefined && !corpusFile))
  throw Error(
    "Usage: bun prepare-recorded-particle-packets.mjs <local replay.rofl> [--opcode 938|1164 <fresh .cache JSON>]",
  );
if (corpusFile) {
  const [cache, parent] = await Promise.all([
    realpath(".cache"),
    realpath(dirname(output)),
  ]);
  const privatePath = relative(cache, parent);
  if (isAbsolute(privatePath) || privatePath.split(/[\\/]/u, 1)[0] === "..")
    throw Error("Expected a fresh private .cache output");
}
const bytes = await Bun.file(path).arrayBuffer();
const sha256 = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const replay = openReplay(bytes);
const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
const packets = [];
const selectedOpcode = opcodeArgument === "1164" ? 1164 : 938;
for (const {
  opcode,
  timeSeconds,
  sequence,
  context,
  payload,
} of readRecordedRiftEffectPackets(replay, decompress))
  if (opcode === selectedOpcode)
    packets.push([
      timeSeconds,
      sequence,
      context,
      Buffer.from(payload).toString("hex"),
    ]);
if (corpusFile) {
  const corpus = {
    replaySha256: sha256,
    build: replay.build,
    protocol: replay.protocol,
    opcode: selectedOpcode,
    packets,
  };
  const serialized = JSON.stringify(corpus) + "\n";
  await writeFile(output, serialized, { encoding: "utf8", flag: "wx" });
  console.log(createHash("sha256").update(serialized).digest("hex"));
} else {
  console.log(
    JSON.stringify({
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: sha256,
      packets,
    }),
  );
}
