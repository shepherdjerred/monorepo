import type {
  GameStateView,
  Response,
  Status,
  GameEventEntry,
  InputRecord,
} from "@discord-plays-pokemon/common";

export const KEYMAP: Readonly<Partial<Record<string, string>>> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  KeyZ: "a",
  KeyX: "b",
  KeyQ: "lb",
  KeyE: "rb",
  Enter: "start",
  ShiftLeft: "select",
  ShiftRight: "select",
};

export type Game = {
  connected: boolean;
  status: Status | null;
  state: GameStateView | null;
  events: GameEventEntry[];
  inputs: InputRecord[];
  notice: string | null;
};
export const EMPTY_GAME: Game = {
  connected: false,
  status: null,
  state: null,
  events: [],
  inputs: [],
  notice: null,
};
export const REFUSALS = {
  "no-session": "No game is running. Start a /play session in Discord.",
  "signed-out": "Sign in with Discord to watch and play.",
  "not-in-voice": "Join the game's voice channel to watch and play.",
  "too-few-players": "Waiting for more players in the voice channel.",
  "goal-mode": "The goal agent has the controls. You can still watch.",
  invalid: "That chord is not valid. Try 3a up or left.",
};

export function reduceGame(game: Game, response: Response): Game {
  switch (response.kind) {
    case "status":
      return { ...game, status: response.value };
    case "state":
      return { ...game, state: response.value };
    case "events":
      return { ...game, events: response.value };
    case "inputs":
      return { ...game, inputs: response.value };
    case "input-result":
      return {
        ...game,
        notice: response.value.accepted
          ? null
          : REFUSALS[response.value.reason],
      };
  }
}

export function disabledReason(game: Game, signedIn: boolean): string | null {
  if (!game.connected) return "Connecting to the game server…";
  if (game.status === null) return "Checking the game session…";
  if (!game.status.sessionActive) return REFUSALS["no-session"];
  if (!signedIn) return REFUSALS["signed-out"];
  const blocker = game.status.playBlocker;
  if (blocker === "not-in-voice") {
    return `Join ${game.status.voiceChannelName ?? "the game's voice channel"} in Discord to watch and play.`;
  }
  if (blocker === "too-few-players") {
    return `Waiting for ${String(game.status.minimumInChannel)} players in voice (${String(game.status.playerList.length)} here).`;
  }
  if (blocker !== null) return REFUSALS[blocker];
  return game.state?.goal?.status === "running" ? REFUSALS["goal-mode"] : null;
}
