import { mkdir } from "node:fs/promises";
import path from "node:path";
import { diagnosticPaths } from "#learning/native/diagnostics/options.ts";
import { frozenManifest, openPaperDuels } from "./sandbox.ts";
import {
  actorHashes,
  diagnosticManifest,
} from "#learning/native/diagnostics/actor.ts";

const { model, output } = diagnosticPaths();
const checked = await diagnosticManifest(model);
const artifacts = await actorHashes(model);
if (checked.onnx_sha256 !== artifacts.actor)
  throw new Error("diagnostic actor digest differs");
const native = await frozenManifest();
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
await Bun.write(
  path.join(output, "inputs.json"),
  JSON.stringify(
    {
      native,
      artifacts,
      model,
      acceptance: "unaccepted",
      controller: "Java ONNX Runtime",
      retries: 0,
    },
    null,
    2,
  ) + "\n",
);
const paper = await openPaperDuels(output, model);
const matches = [];
try {
  await paper.inference.load();
  let seed = 600_000_000;
  for (const opponent of ["authored", "basic"] as const) {
    for (const side of ["red", "blue"] as const) {
      await paper.duels.waitFor((state) => state.phase === "LOBBY", 30_000);
      await paper.inference.begin(seed, side, opponent);
      const live = await paper.duels.waitFor(
        (state) => state.result === "live",
        15_000,
      );
      const done = await paper.duels.waitFor(
        (state) => ["win", "loss", "draw", "timeout"].includes(state.result),
        90_000,
      );
      const metrics = await paper.inference.metrics();
      if (
        done.match !== live.match ||
        done.seed !== seed ||
        done.side !== side ||
        done.opponent !== opponent ||
        done.mode !== "external"
      )
        throw new Error("Java diagnostic duel identity changed");
      if (
        metrics.delivery.applied !== done.applied ||
        metrics.delivery.unavailable + metrics.delivery.ineligible !==
          done.fallback ||
        done.applied === 0
      )
        throw new Error("Java action delivery accounting differs");
      matches.push({ seed, side, opponent, state: done, metrics });
      await Bun.write(
        path.join(output, "matches.json"),
        JSON.stringify(matches, null, 2) + "\n",
      );
      seed++;
    }
  }
} finally {
  await paper.stop();
}
if (
  JSON.stringify(await frozenManifest()) !== JSON.stringify(native) ||
  JSON.stringify(await actorHashes(model)) !== JSON.stringify(artifacts)
)
  throw new Error("Java diagnostic inputs changed during verification");
const inference = matches.at(-1)?.metrics.inference;
if (
  inference?.rejected !== 0 ||
  inference.expired !== 0 ||
  inference.stale !== inference.contextDrops ||
  inference.skipped !== 0
)
  throw new Error("Java diagnostic inference lost native contexts");
if (
  !matches.some((match) => match.state.dealt > 0) ||
  !matches.some((match) => match.state.received > 0)
)
  throw new Error(
    "Java diagnostic native damage was not observed in both directions",
  );
const report = {
  version: 1,
  acceptance: "unaccepted",
  pilotAcceptanceChecked: false,
  learnedControlEnabled: false,
  artifacts,
  matches: matches.length,
  applied: matches.reduce(
    (sum, match) => sum + match.metrics.delivery.applied,
    0,
  ),
  unavailable: matches.reduce(
    (sum, match) => sum + match.metrics.delivery.unavailable,
    0,
  ),
  authoredIneligible: matches.reduce(
    (sum, match) => sum + match.metrics.delivery.ineligible,
    0,
  ),
  inference,
};
await Bun.write(
  path.join(output, "verification.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.warn(JSON.stringify(report));
