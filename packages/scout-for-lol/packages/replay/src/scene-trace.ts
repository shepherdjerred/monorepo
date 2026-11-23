import { z } from "zod";
import type { ReplayParticipant, ReplayPerspective } from "./types.ts";

const ParticipantIdSchema = z.number().int().nonnegative();
const ParticipantSchema = z.object({
  participantId: ParticipantIdSchema,
  name: z.string(),
  championName: z.string(),
  teamId: z.union([z.literal(100), z.literal(200)]),
}) satisfies z.ZodType<ReplayParticipant>;

const TeamPerspectiveSchema = z.enum(["blue", "red"]) satisfies z.ZodType<
  Exclude<ReplayPerspective, "all">
>;

const FrameSchema = z.object({
  timeSeconds: z.number().nonnegative(),
  actors: z.array(
    z.object({
      participantId: ParticipantIdSchema,
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      visibleTo: z.array(TeamPerspectiveSchema),
    }),
  ),
  directedParticipantId: ParticipantIdSchema.nullable(),
});

function validateFrameActors(
  frame: ReplaySceneFrame,
  frameIndex: number,
  scene: { width: number; height: number; participantIds: ReadonlySet<number> },
  context: z.RefinementCtx,
): void {
  const actorIds = new Set<number>();
  for (const [actorIndex, actor] of frame.actors.entries()) {
    if (
      !scene.participantIds.has(actor.participantId) ||
      actorIds.has(actor.participantId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["frames", frameIndex, "actors", actorIndex, "participantId"],
        message: "Each actor must reference a distinct trace participant",
      });
    }
    if (actor.x > scene.width || actor.y > scene.height) {
      context.addIssue({
        code: "custom",
        path: ["frames", frameIndex, "actors", actorIndex],
        message: "Actor coordinates must lie within the scene bounds",
      });
    }
    actorIds.add(actor.participantId);
  }

  if (
    frame.directedParticipantId !== null &&
    !actorIds.has(frame.directedParticipantId)
  ) {
    context.addIssue({
      code: "custom",
      path: ["frames", frameIndex, "directedParticipantId"],
      message: "The directed participant must have an actor in this frame",
    });
  }
}

const TraceSchema = z
  .object({
    durationSeconds: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
    participants: z.array(ParticipantSchema),
    frames: z.tuple([FrameSchema], FrameSchema),
  })
  .superRefine((trace, context) => {
    const participantIds = new Set<number>();
    for (const [index, { participantId }] of trace.participants.entries()) {
      if (participantIds.has(participantId)) {
        context.addIssue({
          code: "custom",
          path: ["participants", index, "participantId"],
          message: "Participant IDs must be unique",
        });
      }
      participantIds.add(participantId);
    }

    if (
      trace.frames[0].timeSeconds !== 0 ||
      trace.frames.at(-1)?.timeSeconds !== trace.durationSeconds
    ) {
      context.addIssue({
        code: "custom",
        path: ["frames"],
        message: "Frames must start at zero and end at the trace duration",
      });
    }

    const scene = { width: trace.width, height: trace.height, participantIds };
    let previousTime = -1;
    for (const [frameIndex, frame] of trace.frames.entries()) {
      if (frame.timeSeconds <= previousTime) {
        context.addIssue({
          code: "custom",
          path: ["frames", frameIndex, "timeSeconds"],
          message: "Frame times must increase strictly",
        });
      }
      previousTime = frame.timeSeconds;
      validateFrameActors(frame, frameIndex, scene, context);
    }
  });

export type ReplaySceneFrame = z.infer<typeof FrameSchema>;
export type ReplaySceneTrace = z.infer<typeof TraceSchema>;
export type ReplaySceneSampling = "hold" | "exact";

export function parseReplaySceneTrace(value: unknown): ReplaySceneTrace {
  return TraceSchema.parse(value);
}

/** Hold the last recorded frame by default, or present observations at exact time only. */
export function sampleReplayScene(
  trace: ReplaySceneTrace,
  timeSeconds: number,
  sampling: ReplaySceneSampling = "hold",
): ReplaySceneFrame {
  if (Number.isNaN(timeSeconds)) {
    throw new RangeError("Replay scene time must be a number");
  }
  const { frames } = trace;
  let selected = frames[0];
  let start = 1;
  let end = frames.length;
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    const frame = frames[middle];
    if (frame === undefined) {
      throw new Error("Replay scene trace has a missing frame");
    }
    if (frame.timeSeconds <= timeSeconds) {
      selected = frame;
      start = middle + 1;
    } else {
      end = middle;
    }
  }
  return sampling === "exact" && selected.timeSeconds !== timeSeconds
    ? { timeSeconds, actors: [], directedParticipantId: null }
    : selected;
}
