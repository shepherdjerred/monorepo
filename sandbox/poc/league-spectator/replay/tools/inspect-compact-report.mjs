import { isDeepStrictEqual } from "node:util";
import {
  packReplayRows,
  replayColumnTransfers,
  replayRowAt,
} from "../latest-replay-columns.mjs";

const [
  reportPath,
  outputPath,
  sectionsArgument = "visibilityRequests,effectDescriptors",
] = process.argv.slice(2);
if (!reportPath || !outputPath)
  throw Error(
    "Usage: bun inspect-compact-report.mjs <original-report.json> <output.json>",
  );
const started = performance.now(),
  report = await Bun.file(reportPath).json();
const sections = sectionsArgument.split(",");
if (
  !sections.length ||
  sections.some(
    (section) => !["visibilityRequests", "effectDescriptors"].includes(section),
  )
)
  throw Error("Explicit diagnostic report sections required");
const before = process.memoryUsage(),
  packed = Object.fromEntries(
    sections.map((key) => [key, packReplayRows(report[key])]),
  ),
  buffers = replayColumnTransfers(packed);
const transferredBytes = buffers.reduce(
  (total, buffer) => total + buffer.byteLength,
  0,
);
const received = structuredClone(packed, { transfer: buffers });
const results = {};
for (const key of sections) {
  const expected = report[key],
    actual = received[key];
  for (let index = 0; index < expected.length; index++) {
    if (!isDeepStrictEqual(replayRowAt(actual, index), expected[index]))
      throw Error(`Lossless compact ${key} differs at row ${index}`);
  }
  results[key] = {
    rows: expected.length,
    originalJsonBytes: new TextEncoder().encode(JSON.stringify(expected))
      .byteLength,
    groups: actual.groups.length,
    typedBytes: replayColumnTransfers(actual).reduce(
      (total, buffer) => total + buffer.byteLength,
      0,
    ),
  };
}
const result = {
  schema: 1,
  kind: "lossless-replay-row-transfer-check",
  source: reportPath,
  results,
  transferredBytes,
  elapsedMs: performance.now() - started,
  memoryBefore: before,
  memoryAfter: process.memoryUsage(),
  browserAcceptance: false,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
