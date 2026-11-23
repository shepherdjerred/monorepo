import { createReplayErrors } from "./errors.ts";
import * as Scene from "./scene-trace.ts";
import {
  ReplayCapabilityError,
  type ReplaySession,
  type ReplaySessionState,
  type ReplayStateListener,
} from "./types.ts";

export type ReplaySceneTrace = Scene.ReplaySceneTrace;
export type ReplaySceneFrame = Scene.ReplaySceneFrame;
export function parseReplaySceneTrace(value: unknown): ReplaySceneTrace {
  return Scene.parseReplaySceneTrace(value);
}

type SceneActor = ReplaySceneTrace["frames"][number]["actors"][number];
type FocusPoint = Pick<SceneActor, "participantId" | "x" | "y">;
export type ReplayScenePresentation = {
  draw: (frame: ReplaySceneFrame, focusParticipantId: number | null) => void;
  resize: (width: number, height: number, devicePixelRatio: number) => boolean;
  dispose: () => void;
};
type SceneSource = {
  trace: ReplaySceneTrace;
  sampling: Scene.ReplaySceneSampling;
  sampleFrame?: ((timeSeconds: number) => ReplaySceneFrame) | undefined;
};
type SceneSurface = SceneSource & {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  background: CanvasImageSource | undefined;
  width: number;
  height: number;
};

function visibleActors(surface: SceneSource, state: ReplaySessionState) {
  const frame =
    surface.sampleFrame === undefined
      ? Scene.sampleReplayScene(
          surface.trace,
          state.timeSeconds,
          surface.sampling,
        )
      : surface.sampleFrame(state.timeSeconds);
  const perspective = state.perspective;
  const actors =
    perspective === "all"
      ? frame.actors
      : frame.actors.filter((actor) => actor.visibleTo.includes(perspective));
  return { actors, directedParticipantId: frame.directedParticipantId };
}

function drawScene(
  surface: SceneSurface,
  state: ReplaySessionState,
  freeFocus: FocusPoint | null,
): void {
  const { canvas, context, trace, width, height } = surface;
  const { actors, directedParticipantId } = visibleActors(surface, state);
  const focusId =
    state.camera.mode === "directed"
      ? directedParticipantId
      : state.camera.participantId;
  // Visibility applies before resolving the camera so hidden positions cannot
  // move the viewport, including positions from an earlier visible frame.
  const visibleTarget = actors.find(
    (actor) =>
      actor.participantId ===
      (state.camera.mode === "free" ? freeFocus?.participantId : focusId),
  );
  const focus =
    visibleTarget === undefined
      ? null
      : state.camera.mode === "free"
        ? freeFocus
        : visibleTarget;
  const scale =
    Math.min(width / trace.width, height / trace.height) *
    (focus === null ? 0.9 : 1.45);
  const left = width / 2 - (focus?.x ?? trace.width / 2) * scale;
  const top = height / 2 - (focus?.y ?? trace.height / 2) * scale;

  context.setTransform(
    canvas.width / width,
    0,
    0,
    canvas.height / height,
    0,
    0,
  );
  context.fillStyle = "#0a111e";
  context.fillRect(0, 0, width, height);
  const worldWidth = trace.width * scale;
  const worldHeight = trace.height * scale;
  context.fillStyle = "#132135";
  context.fillRect(left, top, worldWidth, worldHeight);
  if (surface.background !== undefined)
    context.drawImage(surface.background, left, top, worldWidth, worldHeight);
  context.strokeStyle = "#30445f";
  context.lineWidth = 1;
  context.beginPath();
  for (let index = 1; index < 8; index += 1) {
    const x = left + (worldWidth * index) / 8;
    const y = top + (worldHeight * index) / 8;
    context.moveTo(x, top);
    context.lineTo(x, top + worldHeight);
    context.moveTo(left, y);
    context.lineTo(left + worldWidth, y);
  }
  context.stroke();
  context.strokeRect(left, top, worldWidth, worldHeight);

  const markerRadius = Math.max(3, Math.min(7, Math.min(width, height) / 35));
  context.font = "600 12px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  for (const actor of actors) {
    const participant = state.participants.find(
      (member) => member.participantId === actor.participantId,
    );
    if (participant === undefined)
      throw new Error("Scene actor has no participant");
    const x = left + actor.x * scale;
    const y = top + actor.y * scale;
    context.fillStyle = participant.teamId === 100 ? "#66dfeb" : "#ff9a88";
    context.strokeStyle = "#0a111e";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, y, markerRadius, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
    context.strokeText(participant.name, x, y - markerRadius - 3, 100);
    context.fillStyle = "#f2f6ff";
    context.fillText(participant.name, x, y - markerRadius - 3, 100);
  }
}

function sizeScene(
  surface: SceneSurface,
  width: number,
  height: number,
  ratio: number,
): boolean {
  if (
    ![width, height, ratio].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return false;
  const density = Math.min(ratio, 8192 / Math.max(width, height));
  const pixelWidth = Math.max(1, Math.round(width * density));
  const pixelHeight = Math.max(1, Math.round(height * density));
  const changed =
    surface.width !== width ||
    surface.height !== height ||
    surface.canvas.width !== pixelWidth ||
    surface.canvas.height !== pixelHeight;
  if (surface.canvas.width !== pixelWidth) surface.canvas.width = pixelWidth;
  if (surface.canvas.height !== pixelHeight)
    surface.canvas.height = pixelHeight;
  surface.width = width;
  surface.height = height;
  return changed;
}

export function createReplaySceneSession({
  canvas,
  trace,
  signal,
  sampling = "hold",
  sampleFrame,
  background,
  presentation,
}: {
  canvas: HTMLCanvasElement;
  trace: ReplaySceneTrace;
  signal?: AbortSignal;
  sampling?: Scene.ReplaySceneSampling;
  /** Sample decoded positions at the replay clock before perspective and focus are applied. */
  sampleFrame?: (timeSeconds: number) => ReplaySceneFrame;
  /** Decoded image covering the entire trace, with the origin at its top left. */
  background?: CanvasImageSource;
  /** Caller-owned renderer, using the same replay clock and actor visibility. */
  presentation?: ReplayScenePresentation;
}): ReplaySession {
  if (signal?.aborted === true) {
    presentation?.dispose();
    signal.throwIfAborted();
  }
  const source = { trace, sampling, sampleFrame };
  let surface: SceneSurface | null = null;
  if (presentation === undefined) {
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null)
      throw new ReplayCapabilityError(
        "engine-unavailable",
        "Canvas 2D is unavailable",
      );
    surface = {
      canvas,
      context,
      trace,
      sampling,
      sampleFrame,
      background,
      width: canvas.width || 300,
      height: canvas.height || 150,
    };
  }
  const state: ReplaySessionState = {
    timeSeconds: 0,
    durationSeconds: trace.durationSeconds,
    playing: false,
    rate: 1,
    perspective: "all",
    camera: { mode: "free" },
    participants: structuredClone(trace.participants),
  };
  let freeFocus: FocusPoint | null = null;
  let animation: number | undefined;
  let lastAt = 0;
  const listeners = new Set<ReplayStateListener>();

  function cancelAnimation(): void {
    if (animation !== undefined) cancelAnimationFrame(animation);
    animation = undefined;
  }

  function dispose(): void {
    const current = presentation;
    if (surface === null && current === undefined) return;
    surface = null;
    presentation = undefined;
    canvas.removeEventListener("contextlost", contextLost);
    freeFocus = null;
    signal?.removeEventListener("abort", dispose);
    signal = undefined;
    cancelAnimation();
    listeners.clear();
    errors.close();
    current?.dispose();
  }

  const errors = createReplayErrors(dispose);

  function contextLost(): void {
    errors.fail(new Error("Canvas 2D context was lost"));
  }

  function active(): void {
    if (surface === null && presentation === undefined)
      throw new DOMException("Replay scene disposed", "AbortError");
  }

  function notify(): void {
    for (const listener of listeners) listener(structuredClone(state));
  }

  function present(): void {
    if (surface !== null) {
      drawScene(surface, state, freeFocus);
      return;
    }
    const { actors, directedParticipantId } = visibleActors(source, state);
    const focus =
      state.camera.mode === "directed"
        ? directedParticipantId
        : state.camera.mode === "follow"
          ? state.camera.participantId
          : freeFocus?.participantId;
    presentation?.draw(
      { timeSeconds: state.timeSeconds, actors, directedParticipantId },
      actors.some(({ participantId }) => participantId === focus)
        ? (focus ?? null)
        : null,
    );
  }

  function redraw(): boolean {
    try {
      present();
      return true;
    } catch (error) {
      errors.fail(error);
      return false;
    }
  }

  function advance(now: number): boolean {
    const elapsed = Math.max(0, now - lastAt);
    lastAt += elapsed;
    state.timeSeconds = Math.min(
      state.durationSeconds,
      state.timeSeconds + (elapsed / 1000) * state.rate,
    );
    state.playing = state.timeSeconds < state.durationSeconds;
    return state.playing;
  }
  function tick(now: number): void {
    animation = undefined;
    if ((surface === null && presentation === undefined) || !state.playing)
      return;
    const playing = advance(now);
    if (!redraw()) return;
    if (playing) animation = requestAnimationFrame(tick);
    notify();
  }

  function changeView(): void {
    if (redraw()) notify();
  }

  function resizeOutput(
    width?: number,
    height?: number,
    devicePixelRatio?: number,
  ): boolean {
    const bounds = canvas.getBoundingClientRect();
    const dimensions = [
      width ?? bounds.width,
      height ?? bounds.height,
      devicePixelRatio ?? (globalThis.devicePixelRatio || 1),
    ] as const;
    return surface === null
      ? (presentation?.resize(...dimensions) ?? false)
      : sizeScene(surface, ...dimensions);
  }

  try {
    resizeOutput();
    present();
  } catch (error) {
    dispose();
    throw error;
  }
  if (surface !== null) canvas.addEventListener("contextlost", contextLost);
  signal?.addEventListener("abort", dispose, { once: true });

  return {
    play() {
      active();
      if (state.playing) return;
      if (state.timeSeconds === state.durationSeconds) {
        state.timeSeconds = 0;
        if (!redraw()) return;
      }
      state.playing = true;
      lastAt = performance.now();
      animation = requestAnimationFrame(tick);
      notify();
    },
    pause() {
      active();
      if (!state.playing) return;
      advance(performance.now());
      state.playing = false;
      cancelAnimation();
      changeView();
    },
    seek(timeSeconds) {
      return new Promise<void>((resolve) => {
        active();
        if (!Number.isFinite(timeSeconds))
          throw new RangeError("Seek time must be finite");
        state.timeSeconds = Math.max(
          0,
          Math.min(state.durationSeconds, timeSeconds),
        );
        lastAt = performance.now();
        if (state.timeSeconds === state.durationSeconds) {
          state.playing = false;
          cancelAnimation();
        }
        changeView();
        resolve();
      });
    },
    setRate(rate) {
      active();
      if (!Number.isFinite(rate) || rate <= 0)
        throw new RangeError("Playback rate must be finite and positive");
      if (state.rate === rate) return;
      if (state.playing && !advance(performance.now())) cancelAnimation();
      state.rate = rate;
      changeView();
    },
    focusParticipant(participantId) {
      active();
      const target = visibleActors(source, state).actors.find(
        (actor) => actor.participantId === participantId,
      );
      freeFocus =
        target === undefined
          ? null
          : {
              participantId: target.participantId,
              x: target.x,
              y: target.y,
            };
      state.camera = { mode: "free" };
      changeView();
    },
    setCamera(camera) {
      active();
      if (
        freeFocus === null &&
        camera.mode === state.camera.mode &&
        camera.participantId === state.camera.participantId
      )
        return;
      freeFocus = null;
      state.camera = { ...camera };
      changeView();
    },
    setPerspective(perspective) {
      active();
      if (state.perspective === perspective) return;
      freeFocus = null;
      state.perspective = perspective;
      changeView();
    },
    resize(width, height, devicePixelRatio) {
      active();
      if (resizeOutput(width, height, devicePixelRatio)) redraw();
    },
    dispose,
    getState() {
      active();
      return structuredClone(state);
    },
    subscribe(listener) {
      active();
      listeners.add(listener);
      listener(structuredClone(state));
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeErrors: errors.subscribe,
  };
}
