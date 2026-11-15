import { createLogger } from "#src/logger.ts";
import {
  checkLiveGameRecording,
  type LiveGameRecordingPayload,
  type LiveGameRecordingRefusal,
  type LiveGameRecordingRefusalReason,
  type ScoutClientObservation,
} from "@scout-for-lol/data";

const logger = createLogger("scout-client-live-recording");

/**
 * A `live_game_recording` the ingress will not store: it is over the size cap,
 * carries a key that names a player or other withheld data, or does not match
 * the allowlist shape. The HTTP boundary answers it with a typed 422.
 */
export class ScoutClientLiveRecordingRefused extends Error {
  constructor(
    readonly observationId: string,
    readonly reason: LiveGameRecordingRefusalReason,
    readonly detail: string,
  ) {
    super(`live game recording refused: ${reason}`);
  }

  body(): LiveGameRecordingRefusal {
    return {
      error: "live_game_recording_refused",
      reason: this.reason,
      observationId: this.observationId,
      detail: this.detail,
    };
  }
}

/**
 * Refuse the batch if any `live_game_recording` in it is not an allowlisted
 * recording. Pure and database-free; run before anything is written so one
 * refused recording stores nothing of its batch.
 */
export function refuseInvalidLiveRecordings(
  observations: readonly ScoutClientObservation[],
): void {
  for (const observation of observations) {
    if (observation.kind !== "live_game_recording") continue;
    const check = checkLiveGameRecording(observation.payload);
    if (!check.accepted) {
      throw new ScoutClientLiveRecordingRefused(
        observation.observationId,
        check.reason,
        check.detail,
      );
    }
  }
}

/** A recording that was stored, with the provenance it was stored under. */
export type AcceptedLiveGameRecording = {
  readonly observationId: string;
  readonly deviceId: string;
  /** The signed-in Scout user that owns the uploading device. */
  readonly ownerId: string;
  readonly gameId: string | null;
  readonly recording: LiveGameRecordingPayload;
};

/**
 * What happens to a recording after it is stored.
 *
 * DEFERRED: the post-game review. It needs the recording joined to the
 * resolved match, which is the next piece of the coach work. Until it exists a
 * recording is stored as evidence and nothing reads it; this stub is the one
 * place that consumer attaches, so ingress does not change when it lands.
 */
export function consumeLiveGameRecording(
  recording: AcceptedLiveGameRecording,
): void {
  logger.info(
    `stored live game recording ${recording.observationId} with ${String(recording.recording.data.samples.length)} samples`,
  );
}

/** The recording a stored observation carries, if it is one. */
export function liveGameRecordingOf(
  observation: ScoutClientObservation,
): LiveGameRecordingPayload | null {
  if (observation.kind !== "live_game_recording") return null;
  const check = checkLiveGameRecording(observation.payload);
  return check.accepted ? check.recording : null;
}
