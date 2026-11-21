import type { WebRoomPlayer } from "@shepherdjerred/streambot/web/shared/contracts.ts";

/** When the room snapshot was built on the server, and when this page received it. */
export type RoomClock = {
  readonly serverTime: number;
  readonly receivedAt: number;
};

/**
 * The playback position at `now` (this page's clock), advanced from the server's last sample.
 * The server's clock is never compared with ours directly: the time since the sample is measured
 * on the server's timeline (`serverTime - positionAt`) plus the time this page has held the
 * snapshot (`now - receivedAt`). Only a streaming, unpaused player advances; the result never
 * runs past the item's duration.
 */
export function playbackPosition(
  player: Pick<
    WebRoomPlayer,
    "positionSeconds" | "positionAt" | "paused" | "state" | "current"
  >,
  clock: RoomClock,
  now: number,
): number | null {
  if (player.positionSeconds === null) return null;
  const advancing = player.state === "streaming" && !player.paused;
  const elapsedMs = advancing
    ? Math.max(0, clock.serverTime - player.positionAt) +
      Math.max(0, now - clock.receivedAt)
    : 0;
  const position = player.positionSeconds + elapsedMs / 1000;
  const duration = player.current?.durationSeconds ?? null;
  return duration === null ? position : Math.min(position, duration);
}

/** `m:ss`, or `h:mm:ss` from an hour; `—` when unknown. */
export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${String(minutes)}:${rest}`;
}
