import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { frozenManifest, openPaperDuels } from "./sandbox.ts";

const args = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
const digest = async (file: string) =>
  new Bun.CryptoHasher("sha256")
    .update(await Bun.file(file).arrayBuffer())
    .digest("hex");
const hashes = async () => ({
  manifest: await digest(path.join(model, "manifest.json")),
  actor: await digest(path.join(model, "actor.onnx")),
});
const manifest: unknown = await Bun.file(
  path.join(model, "manifest.json"),
).json();
const checked = z
  .object({
    schema: z.literal(1),
    kind: z.literal("rwf-trooper-ppo"),
    acceptance: z.literal("unaccepted"),
    onnx_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .parse(manifest);
const artifacts = await hashes();
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
  JSON.stringify(await hashes()) !== JSON.stringify(artifacts)
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
