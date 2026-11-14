/** Bounded provider outcomes; raw upstream messages never become user-facing text. */
export type SportsFailureKind =
  | "ended"
  | "subscriber-only"
  | "unsupported-format"
  | "unavailable"
  | "timeout"
  | "session-expired";

export class SportsPlaybackError extends Error {
  constructor(
    readonly kind: SportsFailureKind,
    options?: ErrorOptions,
  ) {
    super(`Sports playback failed: ${kind}`, options);
    this.name = "SportsPlaybackError";
  }
}

export function sportsFailureMessage(error: SportsPlaybackError): string {
  switch (error.kind) {
    case "ended":
      return "That sports event has ended. Choose a live event.";
    case "subscriber-only":
      return "That event only has subscriber streams, which Streambot can't play. Choose a free event.";
    case "unsupported-format":
      return "The available free feeds use a player format Streambot can't play yet.";
    case "unavailable":
      return "None of this event's free servers could provide playable audio and video.";
    case "timeout":
      return "The sports provider took too long. Please try again later.";
    case "session-expired":
      return "The sports media session expired and could not be renewed. Start the live event again.";
  }
}
