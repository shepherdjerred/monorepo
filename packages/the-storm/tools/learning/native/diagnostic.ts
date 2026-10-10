import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { captureInputs, buildCaptureInputs } from "./inputs.ts";
import { originalRecordings } from "./recordings.ts";
import { openPaperDuels } from "#learning/sandbox.ts";
import { capturePair } from "./pairs.ts";
import type { NativeClip } from "./pairs.ts";

const args = parseArgs({
  options: {
    model: { type: "string" },
    output: { type: "string" },
    opponent: { type: "string", default: "basic" },
  },
  strict: true,
});
const model = path.resolve(z.string().min(1).parse(args.values.model));
const output = path.resolve(z.string().min(1).parse(args.values.output));
const opponent = z.enum(["basic", "authored"]).parse(args.values.opponent);
await buildCaptureInputs();
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
const clips: NativeClip[] = [];
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
  await capturePair({
    paper,
    observer,
    name: "diagnostic",
    seed: 600_090_001,
    side: "red",
    opponent,
    onClip: async (clip) => {
      clips.push(clip);
      await save(`${clip.mode}.json`, clip);
    },
  });
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
