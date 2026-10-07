import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { buildCaptureInputs, captureInputs } from "./inputs.ts";
import { originalRecordings } from "./recordings.ts";
import { verifyLiveWindow } from "./window-gate.ts";
import { recordDuel } from "#client/duel-recording.ts";
import { validateDuelClock } from "#client/duel-clock.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";
import { run } from "#learning/preference/media.ts";
import { openPaperDuels, root } from "#learning/sandbox.ts";

const args = parseArgs({
  options: { output: { type: "string" } },
  strict: true,
});
const output = path.resolve(z.string().min(1).parse(args.values.output));
await buildCaptureInputs();
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const save = (name: string, value: unknown) =>
  seal(path.join(output, name), jsonText(value));
const actorDirectory = path.join(output, "idle-actor");
await run([
  "uv",
  "--directory",
  path.join(root, "tools/learning"),
  "run",
  "--locked",
  "python",
  "-m",
  "native.idle_actor",
  "--output",
  actorDirectory,
]);
const actor = z
  .strictObject({
    schema: z.literal(1),
    acceptance: z.literal("unaccepted"),
    diagnostic: z.literal(true),
    provenance: z.literal("diagnostic-native-window"),
    training_run: z.literal(false),
    human_demonstrations_used: z.literal(false),
    actions: z.strictObject({
      move: z.literal(4),
      jump: z.literal(1),
      sneak: z.literal(0),
      sprint: z.literal(0),
      attack: z.literal(0),
    }),
    actor_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    parity: z.unknown(),
  })
  .parse(await Bun.file(path.join(actorDirectory, "diagnostic.json")).json());
await save("idle-actor.json", actor);
const model = path.join(actorDirectory, "onnx");
const inputs = await captureInputs(model);
if (actor.actor_sha256 !== inputs.artifacts.actor)
  throw new Error("Native timing actor differs from its diagnostic export");
await save("inputs.json", {
  schema: 1,
  acceptance: "unaccepted",
  diagnostic: true,
  retries: 0,
  inputs,
});

async function collect() {
  const paper = await openPaperDuels(output, model);
  try {
    await paper.inference.load();
    const observer = await paper.openObserver();
    await paper.duels.command("begin 600089999 red authored basic");
    const warmup = await paper.duels.waitFor(
      (state) => !["waiting", "live"].includes(state.result),
      90_000,
    );
    if (!["win", "loss", "draw", "timeout"].includes(warmup.result))
      throw new Error("Native live-window warm-up was interrupted");
    await paper.duels.command("cancel");
    await paper.duels.waitFor((state) => state.phase === "LOBBY", 30_000);
    observer.requireAlive();
    const expected = {
      seed: 600_090_010,
      side: "red",
      mode: "external",
      opponent: "stationary",
    } as const;
    const clip = await recordDuel({
      session: observer.session,
      duels: paper.duels,
      name: "full-live-window",
      expected,
      begin: () =>
        paper.inference.begin(expected.seed, expected.side, expected.opponent),
    });
    const metrics = await paper.inference.metrics();
    await save("original-match.json", {
      state: clip.state,
      setup: clip.setup,
      metrics,
      video: clip.video,
      frame_receipt: clip.framesFile,
      clock_receipt: clip.clockFile,
    });
    const clock = validateDuelClock(await Bun.file(clip.clockFile).json());
    const window = verifyLiveWindow(clip.frames, clock, clip.state, metrics);
    return { clip, metrics, warmup, window };
  } finally {
    await paper.stop();
  }
}

async function verify() {
  const { clip, metrics, warmup, window } = await collect();
  if (JSON.stringify(await captureInputs(model)) !== JSON.stringify(inputs))
    throw new Error("Native live-window model or renderer changed");
  const recordings = await originalRecordings(output, [clip.state]);
  await save("verification.json", {
    schema: 1,
    kind: "rwf-native-full-live-window-diagnostic",
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    model,
    inputs,
    warmup,
    ...window,
    originalMatch: clip.state,
    setup: clip.setup,
    metrics,
    frame_receipt: clip.framesFile,
    frame_receipt_sha256: await digestFile(clip.framesFile),
    clock_receipt: clip.clockFile,
    clock_receipt_sha256: await digestFile(clip.clockFile),
    video: clip.video,
    recordings,
    fullLiveWindow: true,
    terminalFrameHeld: false,
    trainingPerformed: false,
    humanPreferenceMeasured: false,
    rolloutEnabled: false,
  });
}
try {
  await verify();
} catch (error) {
  await save("failure.json", {
    schema: 1,
    acceptance: "unaccepted",
    diagnostic: true,
    retries: 0,
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
console.warn(`Verified original full native live window: ${output}`);
