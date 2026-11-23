import type {
  ReplayPerspective,
  ReplaySessionState,
} from "@scout-for-lol/replay";

export type ReplayShareState = {
  timeSeconds: number;
  participantId: number | null;
  perspective: ReplayPerspective;
};

function parseReplayTime(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const time = Number(value);
  return Number.isFinite(time) && time >= 0 ? time : null;
}

/** URL values are user input; invalid values never reach simulation. */
export function readReplayShareState(
  search: string,
  durationSeconds: number,
): ReplayShareState {
  const params = new URLSearchParams(search);
  const time = parseReplayTime(params.get("t"));
  const participant = params.get("follow");
  const participantId =
    participant === null || participant.trim().length === 0
      ? null
      : Number(participant);
  const perspective = params.get("perspective");
  return {
    timeSeconds: time === null ? 0 : Math.min(time, durationSeconds),
    participantId:
      participantId !== null &&
      Number.isSafeInteger(participantId) &&
      participantId >= 0
        ? participantId
        : null,
    perspective:
      perspective === "blue" || perspective === "red" ? perspective : "all",
  };
}

export function replayShareUrl(
  href: string,
  state: ReplaySessionState | null,
): string {
  const url = new URL(href);
  const shared = readReplayShareState(url.search, Infinity);
  const time = state?.timeSeconds ?? parseReplayTime(url.searchParams.get("t"));
  url.hash = "";
  url.search = "";
  const participantId =
    state === null
      ? shared.participantId
      : state.camera.mode === "follow"
        ? (state.camera.participantId ?? null)
        : null;
  const perspective = state?.perspective ?? shared.perspective;
  // Rounding can seek to the other side of a recorded state transition.
  if (time !== null && Number.isFinite(time) && time >= 0)
    url.searchParams.set("t", time.toString());
  if (participantId !== null)
    url.searchParams.set("follow", participantId.toString());
  if (perspective !== "all") url.searchParams.set("perspective", perspective);
  return url.href;
}

export function replayClock(timeSeconds: number): string {
  const seconds = Math.floor(Math.max(0, timeSeconds));
  return `${Math.floor(seconds / 60).toString()}:${(seconds % 60).toString().padStart(2, "0")}`;
}
