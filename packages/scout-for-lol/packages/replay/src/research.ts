import { whileActive } from "./session.ts";
import { createReplayErrors } from "./errors.ts";
import { z } from "zod";
import {
  ReplayCapabilityError,
  type ReplaySession,
  type ReplayStateListener,
  type ReplayPreparationListener,
} from "./types.ts";

type ResearchEngine = Omit<ReplaySession, "subscribeErrors"> & {
  firstFrame: Promise<void>;
  capabilities: {
    gameBuild: string;
    mapId: number;
    fidelity: string;
    maximumDecodedSeconds: number;
  };
};
type ResearchEngineModule = {
  createLatestViewerEngine: (options: {
    canvas: HTMLCanvasElement;
    viewport: HTMLElement;
    initialReplay: ArrayBuffer;
    endTime: number;
    assetBase: string;
    staticRootSha256: string;
    signal: AbortSignal;
    onState: ReplayStateListener;
    onError: (cause: unknown) => void;
    onPreparation?: ReplayPreparationListener;
  }) => ResearchEngine;
};

function researchWindow(
  duration: number,
  selected: number | undefined,
): number {
  const decoded = selected ?? duration;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(decoded) ||
    decoded <= 0 ||
    decoded > duration
  )
    throw new ReplayCapabilityError(
      "unsupported-capability",
      "The decoded window must fit within the original replay duration",
    );
  return decoded;
}

/** Explicit developer-only adapter for the real 16.21 partial engine.
 * This does not consume or grant native renderer admission. The caller owns a
 * first-party lazy source import; the selected asset root is independently pinned. */
export async function createResearchReplaySession(options: {
  canvas: HTMLCanvasElement;
  replay: ArrayBuffer;
  assetBase: string;
  staticRootSha256: string;
  loadEngine: () => Promise<unknown>;
  replayDurationSeconds: number;
  decodedSeconds?: number;
  signal?: AbortSignal;
  onState?: ReplayStateListener;
  onPreparation?: ReplayPreparationListener;
}): Promise<ReplaySession> {
  let externalSignal = options.signal;
  let stateListener = options.onState;
  const controller = new AbortController();
  const abort = () => {
    controller.abort(externalSignal?.reason);
  };
  if (externalSignal?.aborted === true) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  let engine: ResearchEngine | null = null;
  let disposed = false;
  const subscriptions = new Set<() => void>();
  const errors = createReplayErrors((error) => {
    controller.abort(error);
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const ownedEngine = engine;
    engine = null;
    externalSignal?.removeEventListener("abort", abort);
    externalSignal = undefined;
    stateListener = undefined;
    controller.abort(
      new DOMException("Research replay disposed", "AbortError"),
    );
    ownedEngine?.dispose();
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions.clear();
    errors.close();
  };
  controller.signal.addEventListener("abort", dispose, { once: true });
  try {
    const viewport = options.canvas.parentElement;
    if (!viewport || !/^[0-9a-f]{64}$/.test(options.staticRootSha256))
      throw new ReplayCapabilityError(
        "invalid-package",
        "A mounted canvas and exact selected research asset-root hash are required",
      );
    const decodedSeconds = researchWindow(
      options.replayDurationSeconds,
      options.decodedSeconds,
    );
    const imported = await whileActive(options.loadEngine(), controller.signal);
    const parsed = z
      .object({
        createLatestViewerEngine: z.custom<
          ResearchEngineModule["createLatestViewerEngine"]
        >((value) => typeof value === "function"),
      })
      .safeParse(imported);
    if (!parsed.success)
      throw new ReplayCapabilityError(
        "engine-unavailable",
        "The selected research module has no mountable renderer",
      );
    engine = parsed.data.createLatestViewerEngine({
      canvas: options.canvas,
      viewport,
      initialReplay: options.replay,
      endTime: decodedSeconds,
      assetBase: options.assetBase,
      staticRootSha256: options.staticRootSha256,
      signal: controller.signal,
      onState: (state) => {
        if (!disposed) stateListener?.(structuredClone(state));
      },
      onError: errors.fail,
      ...(options.onPreparation === undefined
        ? {}
        : { onPreparation: options.onPreparation }),
    });
    if (controller.signal.aborted) {
      engine.dispose();
      controller.signal.throwIfAborted();
    }
    await whileActive(engine.firstFrame, controller.signal);
    controller.signal.throwIfAborted();
    if (
      engine.capabilities.gameBuild !== "16.21.829.8620" ||
      ![11, 12].includes(engine.capabilities.mapId) ||
      engine.capabilities.fidelity !== "verified-partial" ||
      !Number.isFinite(engine.capabilities.maximumDecodedSeconds) ||
      engine.capabilities.maximumDecodedSeconds < decodedSeconds
    )
      throw new ReplayCapabilityError(
        "unsupported-capability",
        "The research renderer differs from the declared partial regression",
      );
    const duration = engine.getState().durationSeconds;
    if (
      !Number.isFinite(duration) ||
      Math.round(duration * 1000) !== Math.round(decodedSeconds * 1000)
    )
      throw new ReplayCapabilityError(
        "unsupported-capability",
        "The research renderer did not present the entire requested replay window",
      );
    const active = () => {
      controller.signal.throwIfAborted();
      if (engine === null)
        throw new ReplayCapabilityError(
          "engine-unavailable",
          "The research replay engine is unavailable",
        );
      return engine;
    };
    return {
      subscribeErrors: errors.subscribe,
      play: () => {
        active().play();
      },
      pause: () => {
        active().pause();
      },
      seek: (time) => active().seek(time),
      setRate: (rate) => {
        active().setRate(rate);
      },
      setCamera: (camera) => {
        active().setCamera(camera);
      },
      focusParticipant: (participantId) => {
        active().focusParticipant(participantId);
      },
      setPerspective: (perspective) => {
        active().setPerspective(perspective);
      },
      resize: (width, height, ratio) => {
        active().resize(width, height, ratio);
      },
      getState: () => active().getState(),
      subscribe: (listener) => {
        const unsubscribe = active().subscribe((state) => {
          if (!disposed) listener(structuredClone(state));
        });
        subscriptions.add(unsubscribe);
        return () => {
          subscriptions.delete(unsubscribe);
          unsubscribe();
        };
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
