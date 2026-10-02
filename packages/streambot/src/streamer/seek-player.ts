import type { Player } from "@shepherdjerred/discord-video-stream";
import type { SegmentClock } from "@shepherdjerred/streambot/streamer/segment-clock.ts";
export async function seekPlayer(
  seconds: number,
  clock: SegmentClock,
  activePlayer: () => Player | null,
): Promise<boolean> {
  const player = activePlayer();
  if (player === null) {
    return false;
  }
  const target = Math.max(0, seconds);
  const previousPositionSeconds = clock.position();
  // The replacement observer can begin synchronously inside player.seek(), so expose the target
  // to stall accounting immediately. Do not commit the public position anchor until the real
  // player confirms its replacement pipeline attached successfully.
  const generation = clock.beginSeek(target, previousPositionSeconds);
  try {
    await player.seek(target);
  } catch (error) {
    if (clock.owns(generation) && activePlayer() === player) {
      clock.abortSeek(previousPositionSeconds);
    }
    throw error;
  }
  if (clock.owns(generation) && activePlayer() === player) {
    clock.commitSeek(target);
  }
  return true;
}
