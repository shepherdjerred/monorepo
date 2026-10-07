import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { captureInputs } from "./inputs.ts";
import { originalRecordings } from "./recordings.ts";
import { openPaperDuels, root } from "#learning/sandbox.ts";
import { recordDuel } from "#client/duel-recording.ts";
import { digestFile } from "#learning/preference/ledger.ts";

const args = parseArgs({
  options: { model: { type: "string" }, output: { type: "string" } },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
for (const [directory, tasks] of [
  ["plugin", [":dist:shadowJar", ":dist:fixturesJar"]],
  ["client", ["assemble"]],
] as const) {
  const build = Bun.spawn(
    [
      "mise",
      "exec",
      "--",
      "gradle",
      "-p",
      path.join(root, directory),
      ...tasks,
      "--console=plain",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await build.exited) !== 0)
    throw new Error(`Native model capture build failed: ${directory}`);
}
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const inputs = await captureInputs(model);
const save = async (name: string, value: unknown) =>
  writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
await save("inputs.json", {
  schema: 1,
  acceptance: "unaccepted",
  diagnostic: true,
  retries: 0,
  model,
  ...inputs,
});
const paper = await openPaperDuels(output, model);
const clips = [];
let warmup;
try {
  await paper.inference.load();
  const observer = await paper.openObserver();
  await paper.duels.command("begin 600090000 red authored basic");
  warmup = await paper.duels.waitFor(
    (state) => !["waiting", "live"].includes(state.result),
    90_000,
  );
  await paper.duels.command("cancel");
  for (const mode of ["external", "authored"] as const) {
    observer.requireAlive();
    await paper.duels.waitFor((state) => state.phase === "LOBBY", 30_000);
    const expected = {
      seed: 600_090_001,
      side: "red",
      mode,
      opponent: "basic",
    } as const;
    const clip = await recordDuel({
      session: observer.session,
      duels: paper.duels,
      name: `diagnostic-${mode}`,
      expected,
      begin: async () =>
        mode === "external"
          ? paper.inference.begin(
              expected.seed,
              expected.side,
              expected.opponent,
            )
          : paper.duels.command(
              `begin ${expected.seed.toString()} red authored basic`,
            ),
    });
    const metrics =
      mode === "external" ? await paper.inference.metrics() : null;
    if (
      mode === "external" &&
      (clip.state.applied === 0 ||
        metrics?.delivery.applied !== clip.state.applied ||
        metrics.delivery.unavailable + metrics.delivery.ineligible !==
          clip.state.fallback)
    )
      throw new Error(
        "Native model capture has inconsistent Java delivery accounting",
      );
    clips.push({
      ...expected,
      state: clip.state,
      metrics,
      video: clip.video,
      frame_receipt: clip.framesFile,
      frame_receipt_sha256: await digestFile(clip.framesFile),
      clock_receipt: clip.clockFile,
      clock_receipt_sha256: await digestFile(clip.clockFile),
      terminalFrame: clip.frames.duel.terminalFrame,
      camera: clip.frames.frames[0]?.frame.camera,
    });
    await save(`${mode}.json`, clips.at(-1));
  }
} catch (error) {
  await save("failure.json", {
    schema: 1,
    acceptance: "unaccepted",
    retries: 0,
    error: error instanceof Error ? error.message : String(error),
    originalState: await paper.duels.command("state"),
    completedClips: clips,
  });
  throw error;
} finally {
  await paper.stop();
}
if (JSON.stringify(await captureInputs(model)) !== JSON.stringify(inputs))
  throw new Error("Native model or renderer inputs changed during capture");
const recordings = await originalRecordings(
  output,
  clips.map((clip) => clip.state),
);
await save("verification.json", {
  schema: 1,
  kind: "rwf-native-model-video-diagnostic",
  acceptance: "unaccepted",
  modelSpecific: true,
  pilotAcceptanceChecked: false,
  humanPreferenceMeasured: false,
  rolloutEnabled: false,
  retries: 0,
  inputs,
  warmup,
  clips,
  recordings,
});
console.warn(`Verified native Java-model footage: ${output}`);
