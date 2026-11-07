export const REPLAY_UNIFORM_BINDINGS_POLICY =
  "program-block-bindings-and-raw-samplers-v2";
export function assertReplayRendererPolicy(three) {
  if (three?.REPLAY_UNIFORM_BINDINGS_POLICY !== REPLAY_UNIFORM_BINDINGS_POLICY)
    throw Error(
      "Replay renderer uniform binding policy is stale; run the static THREE renderer preparation command before Play",
    );
}
