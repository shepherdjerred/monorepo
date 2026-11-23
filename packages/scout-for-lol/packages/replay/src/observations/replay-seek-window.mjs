// Scout-owned raw packet window, preserving the validated footer cutoff.
import { findReplayKeyframe } from "./replay-keyframe-index.mjs";
import { replayTimedPacketEnvelopes } from "./replay-packet-clock.mjs";
import { readReplayPacketsFromKeyframe } from "./transport.mjs";

export function readReplaySeekWindow(replay, index, timeSeconds, decompress) {
  if (
    !Number.isFinite(timeSeconds) ||
    timeSeconds < 0 ||
    !Number.isSafeInteger(replay.durationMilliseconds) ||
    timeSeconds > replay.durationMilliseconds / 1000
  )
    throw Error("Seek time must be inside the recorded replay duration");
  const keyframe = findReplayKeyframe(index, timeSeconds);
  if (!keyframe) throw Error("No recorded keyframe at or before the seek time");

  function* packets() {
    const records = readReplayPacketsFromKeyframe(replay, keyframe, decompress);
    for (const packet of replayTimedPacketEnvelopes(records)) {
      if (packet.timeSeconds > timeSeconds) {
        if (packet.stream === 2)
          throw Error(
            "Indexed snapshot extends beyond the requested seek time",
          );
        break;
      }
      yield packet;
    }
  }

  return { keyframe, packets: packets() };
}
