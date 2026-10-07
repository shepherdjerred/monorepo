import path from "node:path";
import { z } from "zod";
import { CaptureClaim, CapturePlan, captureClaimFile } from "./claim.ts";
import { DuelSetup, validateSetup, pairedSetup } from "./setup.ts";
import { captureInputs } from "./inputs.ts";
import { originalRecordings } from "./recordings.ts";
import {
  Digest,
  validateCaptures,
  preferenceSchedule,
} from "#learning/preference/gate.ts";
import type { CaptureSet } from "#learning/preference/gate.ts";
import type { reviewEligibility } from "#learning/preference/eligibility.ts";
import { digestFile, readJson } from "#learning/preference/ledger.ts";
import { DuelStateSchema } from "#learning/duels.ts";
import { InferenceMetrics } from "#learning/inference.ts";
import { Camera } from "#client/video-frames.ts";
import { validateDuelFrames } from "#client/duel-video.ts";
import { validateDuelClock } from "#client/duel-clock.ts";
import { verifyDuelOutcome } from "#client/duel-recording.ts";
import { verifyFrames, verifyVideo } from "#client/video.ts";

const NativeClip = z.strictObject({
  seed: z.number().int(),
  side: z.enum(["red", "blue"]),
  mode: z.enum(["authored", "external"]),
  opponent: z.literal("authored"),
  state: DuelStateSchema,
  setup: DuelSetup,
  metrics: InferenceMetrics.nullable(),
  video: z.strictObject({
    schema: z.literal(1),
    kind: z.literal("rwf-rendered-video"),
    acceptance: z.literal("unaccepted"),
    receipt_sha256: Digest,
    video_sha256: Digest,
    video: z.string().min(1),
    frames: z.literal(900),
    fps: z.literal(30),
    native_window_bound: z.literal(true),
  }),
  frame_receipt: z.string().min(1),
  frame_receipt_sha256: Digest,
  clock_receipt: z.string().min(1),
  clock_receipt_sha256: Digest,
  terminalFrame: z.number().int().min(-1).max(899),
  camera: Camera,
});
const Recording = z.strictObject({
  file: z.string().min(1),
  sha256: Digest,
  match: z.uuid(),
  seed: z.number().int(),
});
const Verification = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-native-preference-capture"),
  acceptance: z.literal("unaccepted"),
  diagnostic: z.literal(false),
  retries: z.literal(0),
  plan_sha256: Digest,
  captures_sha256: Digest,
  pilotAcceptanceChecked: z.literal(false),
  humanPreferenceMeasured: z.literal(false),
  rolloutEnabled: z.literal(false),
  warmup: DuelStateSchema.refine(
    (state) =>
      state.seed === 600_090_000 &&
      state.side === "red" &&
      state.mode === "authored" &&
      state.opponent === "basic" &&
      state.match !== "" &&
      state.applied === 0 &&
      ["win", "loss", "draw", "timeout"].includes(state.result),
    "Original native warm-up was interrupted or changed",
  ),
  clips: z.array(NativeClip).length(40),
  recordings: z.array(Recording).length(40),
});

type Snapshot = (file: string, expected?: string) => Promise<void>;
type Clip = z.infer<typeof NativeClip>;
type Eligibility = Awaited<ReturnType<typeof reviewEligibility>>;
type ClipContext = {
  directory: string;
  camera: CaptureSet["camera"];
  bodies: Set<string>;
  files: Map<string, string>;
  snapshot: Snapshot;
};

async function verifyPlan(context: {
  directory: string;
  pilot: string;
  capturesFile: string;
  eligibility: Eligibility;
  plan: z.infer<typeof CapturePlan>;
  claim: z.infer<typeof CaptureClaim>;
  verification: z.infer<typeof Verification>;
}) {
  const {
    directory,
    pilot,
    capturesFile,
    eligibility,
    plan,
    claim,
    verification,
  } = context;
  if (
    path.resolve(capturesFile) !== path.join(directory, "captures.json") ||
    plan.output !== directory ||
    plan.pilot !== pilot ||
    verification.plan_sha256 !== claim.plan_sha256 ||
    JSON.stringify(plan.schedule) !== JSON.stringify(preferenceSchedule()) ||
    plan.eligibility.actor_sha256 !== eligibility.actor_sha256 ||
    plan.eligibility.native_sha256 !== eligibility.native_sha256 ||
    JSON.stringify(await captureInputs(plan.model)) !==
      JSON.stringify(plan.inputs)
  )
    throw new Error(
      "Native capture claim, schedule, actor or current inputs differ",
    );
}

function ownedEvidence(directory: string, file: string) {
  const relative = path.relative(directory, file);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Native capture evidence is outside its claimed owner");
}

function verifyClipIdentity(
  clip: Clip,
  declared: CaptureSet["pairs"][number]["learned"],
  context: ClipContext,
) {
  if (
    clip.video.video !== path.resolve(context.directory, declared.video) ||
    clip.seed !== declared.state.seed ||
    clip.side !== declared.state.side ||
    clip.mode !== declared.state.mode ||
    clip.opponent !== declared.state.opponent ||
    JSON.stringify(clip.state) !== JSON.stringify(declared.state) ||
    JSON.stringify(clip.metrics) !== JSON.stringify(declared.metrics) ||
    JSON.stringify(clip.camera) !== JSON.stringify(context.camera)
  )
    throw new Error(
      "Original native clip differs from its declared matchup, delivery or camera",
    );
}

async function verifyClip(pair: number, clip: Clip, context: ClipContext) {
  const { directory, snapshot, bodies, files } = context;
  const auditFile = path.join(
    directory,
    `pair-${pair.toString().padStart(2, "0")}-${clip.mode}.json`,
  );
  await snapshot(auditFile);
  if (
    JSON.stringify(NativeClip.parse(await readJson(auditFile))) !==
    JSON.stringify(clip)
  )
    throw new Error("Original per-match capture envelope changed");
  for (const file of [clip.frame_receipt, clip.clock_receipt, clip.video.video])
    ownedEvidence(directory, file);
  for (const fighter of clip.setup.roster) {
    if (bodies.has(fighter.body))
      throw new Error("Native captures reuse original fighter bodies");
    bodies.add(fighter.body);
  }
  await snapshot(clip.frame_receipt, clip.frame_receipt_sha256);
  await snapshot(clip.clock_receipt, clip.clock_receipt_sha256);
  await snapshot(clip.video.video, clip.video.video_sha256);
  if (clip.video.receipt_sha256 !== clip.frame_receipt_sha256)
    throw new Error("Native video has a different original frame receipt");
  const frames = validateDuelFrames(await readJson(clip.frame_receipt));
  const clock = validateDuelClock(await readJson(clip.clock_receipt));
  verifyDuelOutcome(frames, clock, clip.state);
  if (
    frames.duel.terminalFrame !== clip.terminalFrame ||
    JSON.stringify(frames.frames[0]?.frame.camera) !==
      JSON.stringify(clip.camera)
  )
    throw new Error("Original native camera or terminal pixel source changed");
  await verifyFrames(path.dirname(clip.frame_receipt), frames);
  await verifyVideo(clip.video.video, frames);
  for (const frame of frames.frames)
    files.set(
      path.join(path.dirname(clip.frame_receipt), frame.file),
      frame.sha256,
    );
}

/** Bind the one claimed collection to its original pixels, clocks, model and genuine pilot. */
export async function verifyNativeCaptures(
  pilot: string,
  eligibility: Awaited<ReturnType<typeof reviewEligibility>>,
  capturesFile: string,
): Promise<{
  captures: CaptureSet;
  files: { file: string; sha256: string }[];
}> {
  const claim = CaptureClaim.parse(await readJson(captureClaimFile(pilot)));
  const directory = path.resolve(claim.output);
  if (await Bun.file(path.join(directory, "failure.json")).exists())
    throw new Error("A failed native collection cannot enter blind review");
  const planFile = path.join(directory, "plan.json");
  const verificationFile = path.join(directory, "verification.json");
  const plan = CapturePlan.parse(await readJson(planFile));
  const verification = Verification.parse(await readJson(verificationFile));
  const files = new Map<string, string>();
  const snapshot = async (file: string, expected?: string) => {
    const digest = await digestFile(file);
    if (expected !== undefined && digest !== expected)
      throw new Error(`Original native capture changed: ${file}`);
    files.set(file, digest);
  };
  await snapshot(captureClaimFile(pilot));
  await snapshot(planFile, claim.plan_sha256);
  await snapshot(verificationFile);
  await snapshot(capturesFile, verification.captures_sha256);
  await verifyPlan({
    directory,
    pilot,
    capturesFile,
    eligibility,
    plan,
    claim,
    verification,
  });
  for (const file of plan.eligibility.files)
    await snapshot(file.file, file.sha256);
  const captures = validateCaptures(await readJson(capturesFile));
  if (
    captures.actor_sha256 !== eligibility.actor_sha256 ||
    captures.native_sha256 !== eligibility.native_sha256
  )
    throw new Error("Native capture set differs from genuine eligible pilot");
  const bodies = new Set<string>();
  const context = {
    directory,
    camera: captures.camera,
    bodies,
    files,
    snapshot,
  };
  for (const [index, pair] of captures.pairs.entries()) {
    const learned = verification.clips[index * 2];
    const authored = verification.clips[index * 2 + 1];
    if (learned === undefined || authored === undefined)
      throw new Error("Original native pair is missing");
    pairedSetup(
      validateSetup(learned.setup, learned.state),
      validateSetup(authored.setup, authored.state),
    );
    for (const [clip, declared] of [
      [learned, pair.learned],
      [authored, pair.authored],
    ] as const) {
      verifyClipIdentity(clip, declared, context);
      await verifyClip(pair.pair, clip, context);
    }
  }
  const originals = await originalRecordings(
    directory,
    verification.clips.map((clip) => clip.state),
  );
  if (JSON.stringify(originals) !== JSON.stringify(verification.recordings))
    throw new Error(
      "Original native recordings differ from their sealed capture verification",
    );
  for (const file of originals) await snapshot(file.file, file.sha256);
  if (
    captures.pairs.some((pair) =>
      [pair.learned, pair.authored].some(
        (clip) =>
          !originals.some(
            (file) =>
              file.match === clip.state.match &&
              file.file === path.resolve(directory, clip.recording),
          ),
      ),
    )
  )
    throw new Error("Capture set points to a foreign original recording");
  for (const [file, digest] of files)
    if ((await digestFile(file)) !== digest)
      throw new Error(
        `Original native evidence changed during verification: ${file}`,
      );
  return {
    captures,
    files: Array.from(files, ([file, sha256]) => ({ file, sha256 })),
  };
}
