import { sameGameBuild } from "@scout-for-lol/domain/artifacts/replay-transport.mjs";
import { z } from "zod";
import type { ReplayRenderPackageManifest } from "@scout-for-lol/domain/artifacts/replay-support.ts";
import type { ReplayEngineFactory, ReplayEngineSession } from "./engine.ts";
import { createVerifiedResources, loadVerifiedManifest } from "./resources.ts";
import { ReplayCapabilityError } from "./types.ts";
import type * as Model from "./types.ts";
import { createReplayErrors } from "./errors.ts";

export type CreateReplaySessionOptions = Model.CreateReplaySessionOptions;
export type ReplayCamera = Model.ReplayCamera;
export type ReplayMapPoint = Model.ReplayMapPoint;
export type ReplayMapActor = Model.ReplayMapActor;
export type ReplayParticipant = Model.ReplayParticipant;
export type ReplayPlayerScore = Model.ReplayPlayerScore;
export type ReplayPerspective = Model.ReplayPerspective;
export type ReplayPresentationCapabilities =
  Model.ReplayPresentationCapabilities;
export type ReplayScoreboard = Model.ReplayScoreboard;
export type ReplaySession = Model.ReplaySession;
export type ReplaySessionState = Model.ReplaySessionState;
export type ReplayStateListener = Model.ReplayStateListener;
export type ReplayErrorListener = Model.ReplayErrorListener;
export type ReplayRuntimeError = Model.ReplayRuntimeError;
export type ReplayPreparationEvent = Model.ReplayPreparationEvent;
export type ReplayPreparationListener = Model.ReplayPreparationListener;

/** The package entrypoint is an integrity-checked, self-contained engine bundle.
 * Loading it lazily keeps the heavy decoder/render graph off other Scout routes. */
export async function createReplaySession(
  options: CreateReplaySessionOptions,
): Promise<ReplaySession> {
  return createSessionWithEngine(options, async (resources, entrypoint) => {
    // The publication boundary guarantees immutable same-origin package paths.
    // Verify their exact bytes before native import; Blob scripts are excluded
    // by Scout's CSP, while owned Blob workers remain permitted.
    const url = await resources.moduleUrl(entrypoint);
    const module: unknown = await import(/* @vite-ignore */ url);
    const parsed = z
      .object({
        createReplayEngine: z.custom<ReplayEngineFactory>(
          (value) => typeof value === "function",
        ),
      })
      .safeParse(module);
    if (!parsed.success)
      throw new ReplayCapabilityError(
        "engine-unavailable",
        "Replay package has no compatible browser engine entrypoint",
      );
    return parsed.data.createReplayEngine;
  });
}

type EngineLoader = (
  resources: ReturnType<typeof createVerifiedResources>,
  entrypoint: string,
) => Promise<ReplayEngineFactory>;

export async function whileActive<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let cancelled: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    cancelled = () => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error
          ? reason
          : new DOMException("Replay session aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", cancelled, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    if (cancelled) signal.removeEventListener("abort", cancelled);
  }
}

function assertReplayIdentity(
  replay: ArrayBuffer,
  manifest: ReplayRenderPackageManifest,
): void {
  const header = new Uint8Array(replay);
  const versionLength = header[14];
  if (
    versionLength === undefined ||
    versionLength === 0 ||
    versionLength > 64 ||
    header.byteLength < 32 ||
    15 + versionLength > header.byteLength ||
    new TextDecoder().decode(header.subarray(0, 4)) !== "RIOT" ||
    new DataView(replay).getUint16(4, true) !== 2
  )
    throw new ReplayCapabilityError(
      "incompatible-build",
      "A valid ROFL v2 replay is required",
    );
  const build = new TextDecoder("utf-8", { fatal: true })
    .decode(header.subarray(15, 15 + versionLength))
    .replace(/\0+$/, "");
  const protocol = Array.from(header.subarray(6, 14), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (
    !sameGameBuild(build, manifest.gameBuild) ||
    protocol !== manifest.protocol
  )
    throw new ReplayCapabilityError(
      "incompatible-build",
      "Replay and rendering package have different build or protocol identities",
    );
}

function cloneReplayState(state: ReplaySessionState): ReplaySessionState {
  const { scoreboard } = state;
  if (
    scoreboard === undefined ||
    !Object.isFrozen(scoreboard) ||
    !Object.isFrozen(scoreboard.players) ||
    !scoreboard.players.every((player) => Object.isFrozen(player))
  )
    return structuredClone(state);
  // Verified engines can share immutable checkpoints across clocks and callers.
  const { scoreboard: _scoreboard, ...mutableState } = state;
  return { ...structuredClone(mutableState), scoreboard };
}

async function observeCreation(
  pending: Promise<ReplayEngineSession>,
): Promise<void> {
  try {
    await pending;
  } catch {
    // The main await reports errors. A synchronous factory abort may prevent
    // whileActive from attaching to creation, so also handle its late failure.
  }
}

async function adoptEngine(
  pending: Promise<ReplayEngineSession>,
  adopt: (created: ReplayEngineSession) => void,
): Promise<ReplayEngineSession> {
  const created = await pending;
  adopt(created);
  return created;
}

const NativeFirstFrameSchema = z
  .object({
    timeSeconds: z.number().nonnegative(),
    durationSeconds: z.number().positive(),
    rate: z.number().positive(),
    participants: z
      .array(
        z.object({
          participantId: z.number().int().nonnegative(),
          teamId: z.union([z.literal(100), z.literal(200)]),
        }),
      )
      .length(10),
  })
  .refine(
    (state) =>
      state.timeSeconds <= state.durationSeconds &&
      new Set(state.participants.map((player) => player.participantId)).size ===
        10 &&
      state.participants.filter((player) => player.teamId === 100).length ===
        5 &&
      state.participants.filter((player) => player.teamId === 200).length === 5,
  );

export async function createSessionWithEngine(
  options: CreateReplaySessionOptions,
  loadEngine: EngineLoader,
): Promise<ReplaySession> {
  let externalSignal = options.signal;
  const controller = new AbortController();
  const abort = () => {
    controller.abort(externalSignal?.reason);
  };
  if (externalSignal?.aborted === true) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  let engine: ReplayEngineSession | null = null;
  let resources: ReturnType<typeof createVerifiedResources> | null = null;
  let disposed = false;
  const errors = createReplayErrors((error) => {
    controller.abort(error);
  });
  const listeners = new Set<ReplayStateListener>();
  const cleanup = (): unknown[] => {
    if (disposed) return [];
    disposed = true;
    const ownedEngine = engine;
    const ownedResources = resources;
    engine = null;
    resources = null;
    externalSignal?.removeEventListener("abort", abort);
    externalSignal = undefined;
    controller.abort(new DOMException("Replay session disposed", "AbortError"));
    const failures: unknown[] = [];
    for (const owned of [ownedEngine, ownedResources]) {
      try {
        owned?.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    listeners.clear();
    errors.close();
    return failures;
  };
  const dispose = () => {
    const failures = cleanup();
    if (failures.length === 1 && failures[0] instanceof Error)
      throw failures[0];
    if (failures.length > 0)
      throw new AggregateError(failures, "Replay session disposal failed");
  };
  controller.signal.addEventListener(
    "abort",
    () => {
      // The signal already carries the primary failure or cancellation reason.
      // A throwing event listener would report a separate uncaught error.
      cleanup();
    },
    { once: true },
  );
  try {
    controller.signal.throwIfAborted();
    const manifestUrl = new URL(
      options.manifestUrl,
      typeof location === "undefined" ? undefined : location.href,
    );
    if (!["http:", "https:"].includes(manifestUrl.protocol))
      throw new ReplayCapabilityError(
        "invalid-package",
        "Replay package must use HTTP or HTTPS",
      );
    const manifest = await loadVerifiedManifest(
      manifestUrl,
      options.manifestSha256,
      controller.signal,
    );
    assertReplayIdentity(options.replay, manifest);
    resources = createVerifiedResources(
      manifest,
      manifestUrl,
      controller.signal,
    );
    const factory = await whileActive(
      loadEngine(resources, manifest.entrypoint),
      controller.signal,
    );
    controller.signal.throwIfAborted();
    const notify: ReplayStateListener = (state) => {
      if (disposed) return;
      for (const listener of listeners) listener(cloneReplayState(state));
    };
    const creation = adoptEngine(
      factory({
        canvas: options.canvas,
        replay: options.replay,
        manifest,
        resources,
        signal: controller.signal,
        onState: notify,
        onError: errors.fail,
      }),
      (created) => {
        // Adopt the engine in the resolution reaction itself. An abort can run
        // before the awaiting session resumes; disposal must already own it.
        if (disposed) created.dispose();
        else engine = created;
      },
    );
    void observeCreation(creation);
    const created = await whileActive(creation, controller.signal);
    controller.signal.throwIfAborted();
    const barrier: unknown = created.firstFrame;
    if (!z.instanceof(Promise).safeParse(barrier).success)
      throw new ReplayCapabilityError(
        "engine-unavailable",
        "Replay engine did not provide a first-presentation barrier",
      );
    await whileActive(created.firstFrame, controller.signal);
    controller.signal.throwIfAborted();
    const state = created.getState();
    if (!NativeFirstFrameSchema.safeParse(state).success)
      throw new ReplayCapabilityError(
        "unsupported-capability",
        "The engine did not present a complete 5v5 replay world with valid timing",
      );
    const active = () => {
      controller.signal.throwIfAborted();
      if (engine === null)
        throw new ReplayCapabilityError(
          "engine-unavailable",
          "Replay engine is unavailable",
        );
      return engine;
    };
    const session: ReplaySession = {
      ...(created.capabilities === undefined
        ? {}
        : { capabilities: structuredClone(created.capabilities) }),
      ...(created.panCamera === undefined
        ? {}
        : {
            panCamera(deltaX: number, deltaY: number) {
              active().panCamera?.(deltaX, deltaY);
            },
          }),
      ...(created.moveCameraToMap === undefined
        ? {}
        : {
            moveCameraToMap(point) {
              active().moveCameraToMap?.(point);
            },
          }),
      ...(created.adjustCameraZoom === undefined
        ? {}
        : {
            adjustCameraZoom(direction) {
              active().adjustCameraZoom?.(direction);
            },
          }),
      ...(created.setAnnouncerPreview === undefined
        ? {}
        : {
            async setAnnouncerPreview(enabled: boolean) {
              await active().setAnnouncerPreview?.(enabled);
            },
          }),
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
      focusParticipant: (participantId) => {
        active().focusParticipant(participantId);
      },
      setCamera: (camera) => {
        active().setCamera(camera);
      },
      setPerspective: (perspective) => {
        active().setPerspective(perspective);
      },
      resize: (width, height, ratio) => {
        active().resize(width, height, ratio);
      },
      dispose,
      getState: () => cloneReplayState(active().getState()),
      subscribe(listener) {
        const currentState = session.getState();
        listeners.add(listener);
        listener(currentState);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    if (options.onState) session.subscribe(options.onState);
    return session;
  } catch (error) {
    cleanup();
    throw error;
  }
}
