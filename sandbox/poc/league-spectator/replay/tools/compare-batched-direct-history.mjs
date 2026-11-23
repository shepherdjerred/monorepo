import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { checkLargeDirectAdvance } from "./check-large-direct-advance.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { directHistoryControlSource } from "./direct-history-control-source.mjs";

const output = process.argv[2];
if (!output)
  throw Error(
    "Usage: bun compare-batched-direct-history.mjs <comparison.json>",
  );
const historyPath = path.resolve(
    import.meta.dir,
    "../latest-direct-checkpoint-history.mjs",
  ),
  runtimePath = path.resolve(
    import.meta.dir,
    "../latest-direct-effect-runtime.mjs",
  ),
  historyBytes = await Bun.file(historyPath).bytes(),
  runtimeBytes = await Bun.file(runtimePath).bytes(),
  historySource = new TextDecoder().decode(historyBytes),
  runtimeSource = new TextDecoder().decode(runtimeBytes);
const { legacyHistory, legacyRuntime } = directHistoryControlSource({
  historySource,
  runtimeSource,
  legacyHistoryUrl: (source) =>
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`,
  dependencyUrl: (dependency) =>
    pathToFileURL(path.resolve(path.dirname(runtimePath), dependency)).href,
});
const { LatestDirectEffectRuntime: LegacyRuntime } = await import(
  `data:text/javascript;base64,${Buffer.from(legacyRuntime).toString("base64")}`
);
const inspect = (runtime) => {
  const digest = createHash("sha256");
  for (const entry of runtime.ledger) digest.update(JSON.stringify(entry));
  return {
    ledgerSha256: digest.digest("hex"),
    cursor: runtime.cursor,
    checkpointSnapshots: runtime.metrics.checkpointSnapshots,
    checkpointRowsCopied: runtime.metrics.checkpointRowsCopied,
    checkpointGenerationUpdates: runtime.metrics.checkpointGenerationUpdates,
    checkpointMs: runtime.metrics.checkpointMs,
  };
};
const baseline = checkLargeDirectAdvance(LegacyRuntime, inspect);
console.log(JSON.stringify({ stage: "original-per-row", ...baseline }));
const batched = checkLargeDirectAdvance(LatestDirectEffectRuntime, inspect);
console.log(JSON.stringify({ stage: "batched-branches", ...batched }));
for (const field of [
  "events",
  "duration",
  "ledgerRows",
  "instances",
  "simulationSteps",
])
  assert.equal(batched[field], baseline[field]);
for (const field of [
  "ledgerSha256",
  "cursor",
  "checkpointSnapshots",
  "checkpointRowsCopied",
  "checkpointGenerationUpdates",
])
  assert.equal(batched.inspection[field], baseline.inspection[field]);
const report = {
  schema: 1,
  kind: "large-original-vs-batched-direct-checkpoint-history",
  historySha256: await sha256(historyBytes),
  runtimeSha256: await sha256(runtimeBytes),
  controlSha256: await sha256(
    await Bun.file(
      path.join(import.meta.dir, "check-large-direct-advance.mjs"),
    ).bytes(),
  ),
  legacyHistorySha256: await sha256(new TextEncoder().encode(legacyHistory)),
  baseline,
  batched,
  mismatches: [],
  scope:
    "Original per-row branch writes versus batched writes under the identical complete runtime/clone/tick/restore algorithms; all307256 ledger rows hashed after forward/backward replay. All-omitted control only, no actual particles/browser seek acceptance.",
};
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, mismatches: 0 }));
