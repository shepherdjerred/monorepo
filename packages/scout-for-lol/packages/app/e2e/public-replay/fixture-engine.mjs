// This fixture exercises the package loader and presentation contract.
// It has no League gameplay, assets, or replay decoding.
export async function createReplayEngine({
  canvas,
  replay,
  resources,
  onState,
  onError,
}) {
  const worker = await resources.worker("fixture-worker.mjs");
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Fixture requires a 2D canvas");
  let state = {
    timeSeconds: 0,
    durationSeconds: 60,
    playing: false,
    rate: 1,
    perspective: "all",
    camera: { mode: "free" },
    participants: Array.from({ length: 10 }, (_, participantId) => ({
      participantId,
      name: `Fixture player ${participantId}`,
      championName: "Ornn",
      teamId: participantId < 5 ? 100 : 200,
    })),
  };
  function paint() {
    context.fillStyle = state.timeSeconds === 0 ? "#384766" : "#19774b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.font = "20px sans-serif";
    context.textAlign = "center";
    context.fillText(
      "Synthetic replay fixture",
      canvas.width / 2,
      canvas.height / 2,
    );
  }
  function update(change) {
    state = { ...state, ...change };
    paint();
    onState(state);
  }
  const firstFrame = new Promise((resolve, reject) => {
    worker.addEventListener("error", reject, { once: true });
    worker.addEventListener(
      "message",
      ({ data }) => {
        if (data !== "RIOT") {
          reject(new Error("Fixture worker did not receive the replay header"));
          return;
        }
        paint();
        resolve();
      },
      { once: true },
    );
    worker.postMessage(replay);
  });
  worker.addEventListener("error", onError);
  return {
    firstFrame,
    getState: () => state,
    play: () => update({ playing: true }),
    pause: () => update({ playing: false }),
    seek: (timeSeconds) => {
      update({ timeSeconds });
      return Promise.resolve();
    },
    setRate: (rate) => update({ rate }),
    setPerspective: (perspective) => update({ perspective }),
    setCamera: (camera) => update({ camera }),
    focusParticipant: (participantId) =>
      update({ camera: { mode: "follow", participantId } }),
    resize(width, height, ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      paint();
    },
    dispose: () => worker.terminate(),
  };
}
