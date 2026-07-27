// Message contract between the main thread (WorkerEmulator facade) and the
// emulator Worker (emulator-worker.ts). Structured-clone payloads only; byte
// payloads travel as Uint8Array (a posted Buffer arrives as a plain
// Uint8Array — receivers wrap it with a zero-copy Buffer view) and are moved
// with transfer lists, never copied.
//
// Both ends are the same build of this repo, but the whole message — envelope
// AND structured sub-payloads (snapshot, metric batch, input state) — is
// validated with Zod at each receive boundary. A malformed same-build producer
// then fails loudly here instead of injecting undefined fields into RaceTracker
// or replayMetricBatch on the main event loop.
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

// Byte payloads: z.custom<Uint8Array> (not z.instanceof) keeps the inferred
// type as the loose `Uint8Array` so a transferred Buffer<ArrayBufferLike> stays
// assignable, while the predicate still rejects a non-Uint8Array envelope.
const BytesSchema = z.custom<Uint8Array>((v) => v instanceof Uint8Array);

// Full schemas for the decoded structured sub-payloads. The explicit
// `z.ZodType<...>` annotations tie each schema to its source-of-truth type
// (mk64-memory.ts / metric-bridge.ts) so adding a field there fails the build
// here until the schema mirrors it.
const RaceStateSchema = z.enum(["menu", "staging", "racing", "finished"]);
const ScreenModeSchema = z.enum(["1p", "2p-horizontal", "2p-vertical", "quad"]);
const GameModeSchema = z.enum(["gp", "time-trials", "versus", "battle"]);
const Mk64PlayerSnapshotSchema = z.strictObject({
  present: z.boolean(),
  human: z.boolean(),
  rank: z.number(),
  characterId: z.number(),
  finished: z.boolean(),
  raceTimeMs: z.number(),
});
const SnapshotSchema: z.ZodType<Mk64Snapshot> = z.strictObject({
  raceState: RaceStateSchema,
  screenMode: ScreenModeSchema,
  gameMode: GameModeSchema,
  humanCount: z.number(),
  courseId: z.number(),
  players: z.array(Mk64PlayerSnapshotSchema),
});
const MetricBatchSchema: z.ZodType<MetricBatch> = z.strictObject({
  emulateMs: z.array(z.number()),
  lateMs: z.array(z.number()),
  copyMs: z.array(z.number()),
  inputApplyDelayMs: z.array(z.number()),
  ticks: z.number(),
  loopResyncs: z.number(),
  restarts: z.array(z.string()),
});

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
    /** Absolute main-thread arrival time (see InputLatencyTracker). */
    receivedAt: z.number(),
  }),
  z.object({ kind: z.literal("clearPlayerInput"), seat: z.number() }),
  z.object({ kind: z.literal("renderFrame"), id: z.number() }),
  z.object({ kind: z.literal("persistSaves"), id: z.number() }),
  // Backpressure: the main thread acks each frame/audio chunk it dequeues so
  // the worker can bound how many are in flight (see MAX_FRAMES_IN_FLIGHT /
  // MAX_AUDIO_IN_FLIGHT).
  z.object({ kind: z.literal("frameAck") }),
  z.object({ kind: z.literal("audioAck") }),
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
  // Backpressure: the worker acks each drained controller input so the main
  // facade can bound in-flight input posts and coalesce the rest per seat.
  z.object({ kind: z.literal("inputAck") }),
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
  // `id` correlates the failure to a pending request (renderFrame/persistSaves)
  // so the facade can reject that promise instead of leaking it; absent for
  // command-independent errors.
  z.object({
    kind: z.literal("error"),
    message: z.string(),
    id: z.number().optional(),
  }),
]);
export type WorkerToMain = z.infer<typeof WorkerMessageSchema>;

/** Validate a main→worker message (envelope + structured sub-payloads). */
export function parseMainMessage(u: unknown): MainToWorker {
  return MainMessageSchema.parse(u);
}

/** Validate a worker→main message (envelope + structured sub-payloads). */
export function parseWorkerMessage(u: unknown): WorkerToMain {
  return WorkerMessageSchema.parse(u);
}
