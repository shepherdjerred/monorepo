import { chooseAiTurn, type MatchState, type PlayerId } from "@castle-casters/core";

type AiRequest = {
  type: "chooseTurn";
  requestId: string;
  match: MatchState;
  playerId: PlayerId;
  depth: number;
  seed: number;
};

self.addEventListener("message", (event: MessageEvent<AiRequest>) => {
  if (event.data.type !== "chooseTurn") {
    return;
  }
  try {
    const result = chooseAiTurn(event.data.match, event.data.playerId, event.data.depth);
    self.postMessage({ type: "turnChosen", requestId: event.data.requestId, turn: result.turn, stats: result.stats });
  } catch (error) {
    self.postMessage({ type: "aiError", requestId: event.data.requestId, message: error instanceof Error ? error.message : String(error) });
  }
});
