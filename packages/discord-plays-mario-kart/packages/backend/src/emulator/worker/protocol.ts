// Message contract between the main thread (WorkerEmulator facade) and the
// emulator Worker (emulator-worker.ts). Structured-clone payloads only; byte
// payloads travel as Uint8Array (a posted Buffer arrives as a plain
// Uint8Array — receivers wrap it with a zero-copy Buffer view) and are moved
// with transfer lists, never copied.
//
// Both ends are the same build of this repo, so the envelope (kind + scalar
// fields) is validated with Zod at each receive boundary while the decoded
// structured sub-payloads (snapshot, metric batch, input state) are trusted.
import { z } from "zod";
import { PlayerInputStateSchema } from "@discord-plays-mario-kart/common";
import type { Mk64Snapshot } from "#src/emulator/mk64-memory.ts";
import type { MetricBatch } from "./metric-bridge.ts";

// Mirrors EmulatorRestartReason (n64-emulator.ts). Adding a reason there without
// mirroring it here fails the build where WorkerEmulator.restartFromStartMenu
// posts the wider reason into this narrower MainToWorker union.
const RestartReasonSchema = z.enum(["stream_session_ended"]);

const WorkerInitOptsSchema = z.strictObject({
  wasmDir: z.string(),
  romPath: z.string(),
  fps: z.number(),
  software: z.boolean(),
  seats: z.number(),
  savesDir: z.string().optional(),
  /** Decode + post an Mk64Snapshot every N emulated frames (≈3 Hz at 30fps). */
  snapshotEveryNFrames: z.number(),
});
export type WorkerInitOpts = z.infer<typeof WorkerInitOptsSchema>;

// Trusted structured sub-payloads (same-build producers). Buffers are checked
// for type so a corrupt envelope fails loudly; decoded structs pass through.
// z.custom<Uint8Array> (not z.instanceof) keeps the inferred type as the loose
// `Uint8Array` so a transferred Buffer<ArrayBufferLike> stays assignable.
const BytesSchema = z.custom<Uint8Array>((v) => v instanceof Uint8Array);
const SnapshotSchema = z.custom<Mk64Snapshot>();
const MetricBatchSchema = z.custom<MetricBatch>();

const MainMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("init"), opts: WorkerInitOptsSchema }),
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("stop") }),
  z.object({
    kind: z.literal("restartFromStartMenu"),
    reason: RestartReasonSchema,
  }),
  z.object({
    kind: z.literal("setPlayerInput"),
    seat: z.number(),
    state: PlayerInputStateSchema,
  }),
  z.object({ kind: z.literal("clearPlayerInput"), seat: z.number() }),
  z.object({ kind: z.literal("renderFrame"), id: z.number() }),
  z.object({ kind: z.literal("persistSaves"), id: z.number() }),
]);
export type MainToWorker = z.infer<typeof MainMessageSchema>;

const WorkerMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("initFailed"), message: z.string() }),
  z.object({ kind: z.literal("stopped") }),
  z.object({
    kind: z.literal("frame"),
    rgba: BytesSchema,
    height: z.number(),
    seatActivity: z.array(z.boolean()),
  }),
  z.object({ kind: z.literal("audio"), pcm: BytesSchema }),
  z.object({ kind: z.literal("snapshot"), snapshot: SnapshotSchema }),
  z.object({ kind: z.literal("metrics"), batch: MetricBatchSchema }),
  z.object({
    kind: z.literal("renderFrameResult"),
    id: z.number(),
    rgba: BytesSchema,
    width: z.number(),
    height: z.number(),
  }),
  z.object({
    kind: z.literal("persistSavesResult"),
    id: z.number(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type WorkerToMain = z.infer<typeof WorkerMessageSchema>;

/** Validate a main→worker message envelope (structured sub-payloads trusted). */
export function parseMainMessage(u: unknown): MainToWorker {
  return MainMessageSchema.parse(u);
}

/** Validate a worker→main message envelope (structured sub-payloads trusted). */
export function parseWorkerMessage(u: unknown): WorkerToMain {
  return WorkerMessageSchema.parse(u);
}
