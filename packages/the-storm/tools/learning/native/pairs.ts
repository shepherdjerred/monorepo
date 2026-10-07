import { recordDuel } from "#client/duel-recording.ts";
import type { openPaperDuels } from "#learning/sandbox.ts";
import type { openNativeObserver } from "./observer.ts";
import { pairedSetup } from "./setup.ts";
import { digestFile } from "#learning/preference/ledger.ts";

export type NativeClip = Awaited<ReturnType<typeof captureClip>>;
type Paper = Awaited<ReturnType<typeof openPaperDuels>>;
type Observer = Awaited<ReturnType<typeof openNativeObserver>>;

async function captureClip(options: {
  paper: Paper;
  observer: Observer;
  name: string;
  seed: number;
  side: "red" | "blue";
  mode: "authored" | "external";
  opponent: "basic" | "authored";
}) {
  const { paper, observer, name, seed, side, mode, opponent } = options;
  observer.requireAlive();
  await paper.duels.waitFor((state) => state.phase === "LOBBY", 30_000);
  const clip = await recordDuel({
    session: observer.session,
    duels: paper.duels,
    name,
    expected: { seed, side, mode, opponent },
    begin: async () =>
      mode === "external"
        ? paper.inference.begin(seed, side, opponent)
        : paper.duels.command(
            `begin ${seed.toString()} ${side} authored ${opponent}`,
          ),
  });
  const metrics = mode === "external" ? await paper.inference.metrics() : null;
  if (
    mode === "external" &&
    (clip.state.applied === 0 ||
      metrics?.delivery.applied !== clip.state.applied ||
      metrics.delivery.unavailable + metrics.delivery.ineligible !==
        clip.state.fallback)
  )
    throw new Error("Native capture has inconsistent Java delivery accounting");
  const camera = clip.frames.frames[0]?.frame.camera;
  if (camera === undefined) throw new Error("Native capture camera is missing");
  return {
    seed,
    side,
    mode,
    opponent,
    state: clip.state,
    setup: clip.setup,
    metrics,
    video: clip.video,
    frame_receipt: clip.framesFile,
    frame_receipt_sha256: await digestFile(clip.framesFile),
    clock_receipt: clip.clockFile,
    clock_receipt_sha256: await digestFile(clip.clockFile),
    terminalFrame: clip.frames.duel.terminalFrame,
    camera,
  };
}

/** Exactly two original attempts in fixed order. Completed clips are sealed before the next starts. */
export async function capturePair(options: {
  paper: Paper;
  observer: Observer;
  name: string;
  seed: number;
  side: "red" | "blue";
  opponent: "basic" | "authored";
  onClip: (clip: NativeClip) => Promise<void>;
}) {
  const learned = await captureClip({
    ...options,
    name: `${options.name}-external`,
    mode: "external",
  });
  await options.onClip(learned);
  const authored = await captureClip({
    ...options,
    name: `${options.name}-authored`,
    mode: "authored",
  });
  await options.onClip(authored);
  pairedSetup(learned.setup, authored.setup);
  if (JSON.stringify(learned.camera) !== JSON.stringify(authored.camera))
    throw new Error("Native paired cameras differ");
  return { learned, authored };
}
