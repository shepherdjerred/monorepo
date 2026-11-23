import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openReplay } from "../transport.mjs";
import {
  compareReferencePositions,
  planPositionComparison,
} from "./research/compare-reference-positions.mjs";

const usage = [
  "Usage:",
  "  node compare-reference-positions.mjs plan <replay.rofl> <reference.json>",
  "  node compare-reference-positions.mjs compare <replay.rofl> <reference.json> <decoded.json>",
].join("\n");

async function readInput(path, label) {
  try {
    return await readFile(path);
  } catch (error) {
    throw Error(`Could not read ${label} (${error.code ?? error.name})`);
  }
}

async function readJson(path, label) {
  const bytes = await readInput(path, label);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw Error(`Invalid ${label} JSON`);
  }
}

async function main(args) {
  const [mode, replayPath, referencePath, decodedPath] = args;
  if (
    (mode !== "plan" && mode !== "compare") ||
    args.length !== (mode === "plan" ? 3 : 4) ||
    args.some((value) => !value)
  )
    throw Error(usage);

  const bytes = await readInput(replayPath, "replay");
  let replay;
  try {
    replay = openReplay(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  } catch {
    throw Error(
      "Input is not a valid ROFL v2 replay with participant metadata",
    );
  }
  const identity = {
    build: replay.build,
    protocol: replay.protocol,
    durationMilliseconds: replay.durationMilliseconds,
    replaySha256: createHash("sha256").update(bytes).digest("hex"),
    participantCount: replay.roster.length,
  };
  const reference = await readJson(referencePath, "reference");
  const result =
    mode === "plan"
      ? planPositionComparison(identity, reference)
      : compareReferencePositions(
          identity,
          reference,
          await readJson(decodedPath, "decoded positions"),
        );
  console.log(JSON.stringify(result, null, 2));
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
