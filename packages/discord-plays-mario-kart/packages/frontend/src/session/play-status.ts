import type {
  PlayBlocker,
  SeatDeniedResponse,
} from "@discord-plays-mario-kart/common";

export type PlayStatusTone =
  "ready" | "driving" | "blocked" | "idle" | "offline";

export type PlayStatus = {
  readonly tone: PlayStatusTone;
  readonly title: string;
  readonly detail: string;
};

export type PlayStatusInput = {
  readonly connected: boolean;
  readonly blocker: PlayBlocker | null | undefined;
  readonly voiceChannelName: string | null | undefined;
  readonly seat: number | null;
};

/** The one-line explanation of whether, and how, this viewer can play. */
export function describePlayStatus(input: PlayStatusInput): PlayStatus {
  if (!input.connected) {
    return {
      tone: "offline",
      title: "Reconnecting to the game server…",
      detail: "Your seat is released while the connection is down.",
    };
  }
  if (input.seat !== null) {
    return {
      tone: "driving",
      title: `You're driving as P${String(input.seat + 1)}`,
      detail: "Keyboard, gamepad, and the on-screen controller all work.",
    };
  }
  switch (input.blocker) {
    case "signed-out": {
      return {
        tone: "blocked",
        title: "Sign in with Discord to play",
        detail: "Anyone can watch; driving needs your Discord account.",
      };
    }
    case "no-session": {
      return {
        tone: "idle",
        title: "No game running",
        detail: "Start one with /play in Discord, then grab a seat here.",
      };
    }
    case "not-in-voice": {
      return {
        tone: "blocked",
        title: `Join ${channelLabel(input.voiceChannelName)} in Discord to play`,
        detail: "Seats are for players in the call. Join, then pick a seat.",
      };
    }
    case null: {
      return {
        tone: "ready",
        title: "Pick a seat to start driving",
        detail: input.voiceChannelName
          ? `Game running in ${input.voiceChannelName}.`
          : "A game is running.",
      };
    }
    case undefined: {
      return {
        tone: "idle",
        title: "Loading game status…",
        detail: "",
      };
    }
  }
}

function channelLabel(name: string | null | undefined): string {
  return typeof name === "string" ? name : "the game's voice channel";
}

/** Short message for a refused seat claim. */
export function describeSeatDenied(
  reason: SeatDeniedResponse["value"]["reason"],
  voiceChannelName: string | null | undefined,
): string {
  switch (reason) {
    case "signed-out": {
      return "Sign in with Discord before taking a seat.";
    }
    case "no-session": {
      return "No game is running. Start one with /play in Discord.";
    }
    case "not-in-voice": {
      return `Join ${channelLabel(voiceChannelName)} in Discord first.`;
    }
    case "taken": {
      return "Someone grabbed that seat first.";
    }
  }
}
