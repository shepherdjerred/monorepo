import type {
  ReplayDecompressor,
  ReplayObservations,
  ReplayObservedActorState,
  ReplayObservationKdaTimeline,
} from "@scout-for-lol/replay/observations";

export function decodeReplayObservations(
  buffer: ArrayBuffer,
  decompress: ReplayDecompressor,
  options?: { lifecycle?: boolean },
): ReplayObservations;
export function createReplayObservationActorSampler(
  observations: ReplayObservations,
): (timeSeconds: number) => ReplayObservedActorState[];
export function createReplayObservationKdaTimeline(
  observations: ReplayObservations,
): ReplayObservationKdaTimeline;
