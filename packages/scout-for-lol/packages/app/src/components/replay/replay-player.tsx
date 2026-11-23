import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ReplayPresentationCapabilities,
  ReplaySession,
  ReplaySessionState,
} from "@scout-for-lol/replay";
import type { PublicReplayDescriptor } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  createBrowserReplaySession,
  loadPublicReplaySession,
  type ReplaySessionFactory,
} from "#src/lib/replay/load-session.ts";
import { readReplayShareState } from "#src/lib/replay/share-state.ts";
import { runReplayCommand } from "#src/lib/replay/commands.ts";
import { attachSpectatorShortcuts } from "#src/lib/replay/spectator-shortcuts.ts";
import {
  ReplayControls,
  replayPresentationControls,
  type ReplayPresentationControls,
  type ReplayPlaybackControlsProps,
} from "./replay-controls.tsx";
import { ReplayRosterScore, ReplayTeamScore } from "./replay-scoreboard.tsx";
import {
  ReplayCameraCanvas,
  ReplayCameraMinimap,
  type ReplayCameraDrag,
} from "./replay-camera.tsx";

export function ReplayPlayer(props: {
  replay: PublicReplayDescriptor;
  search?: string;
  factory?: ReplaySessionFactory;
  onState?: (state: ReplaySessionState) => void;
  controls?: ReplayPresentationControls;
}) {
  const factory = props.factory ?? createBrowserReplaySession;
  const initialize = useCallback(
    (canvas: HTMLCanvasElement, signal: AbortSignal) =>
      loadPublicReplaySession({
        replay: props.replay,
        canvas,
        signal,
        factory,
      }),
    [props.replay, factory],
  );
  return (
    <ReplaySessionPlayer
      initialize={initialize}
      search={props.search ?? ""}
      {...(props.onState === undefined ? {} : { onState: props.onState })}
      {...(props.controls === undefined ? {} : { controls: props.controls })}
    />
  );
}

/** Shared session ownership for the public player and explicitly labeled local research. */
export function ReplaySessionPlayer(props: {
  initialize: (
    canvas: HTMLCanvasElement,
    signal: AbortSignal,
  ) => Promise<ReplaySession>;
  search?: string;
  onState?: (state: ReplaySessionState) => void;
  controls?: ReplayPresentationControls;
  renderPlaybackControls?: (props: ReplayPlaybackControlsProps) => ReactNode;
  renderCanvasOverlay?: (state: ReplaySessionState) => ReactNode;
  renderTimelineExtras?: (
    state: ReplaySessionState,
    seek: (timeSeconds: number) => Promise<void>,
  ) => ReactNode;
}) {
  const { initialize } = props;
  const surface = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<ReplayCameraDrag | null>(null);
  const session = useRef<ReplaySession | null>(null);
  const failSession = useRef<
    ((cause: unknown, fallback?: string) => void) | null
  >(null);
  const [state, setState] = useState<ReplaySessionState | null>(null);
  const [presentation, setPresentation] = useState<{
    capabilities: ReplayPresentationCapabilities | undefined;
    panning: boolean;
    zooming: boolean;
    minimapUrl: string | undefined;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const search = props.search ?? "";
  const onState = useRef(props.onState);
  onState.current = props.onState;
  const requestedControls = useRef(props.controls);
  requestedControls.current = props.controls;
  const command = useCallback(
    (action: (active: ReplaySession) => void | Promise<void>) =>
      runReplayCommand(
        () => session.current,
        action,
        (failure) =>
          failSession.current?.(failure, "The replay command failed."),
      ),
    [],
  );
  const ready = state !== null && error === null;
  const controls = replayPresentationControls(
    props.controls,
    presentation?.capabilities,
  );
  const panning = ready && presentation?.panning === true;
  const freeCamera = panning && state.camera.mode === "free";
  useEffect(() => {
    const target = canvas.current;
    const owner = surface.current;
    if (!ready || target === null || owner === null) return;
    const abort = new AbortController();
    attachSpectatorShortcuts({
      canvas: target,
      surface: owner,
      current: () => session.current,
      command,
      signal: abort.signal,
    });
    return () => {
      abort.abort();
    };
  }, [ready, command]);

  useEffect(() => {
    const target = canvas.current;
    if (target === null) return;
    const abort = new AbortController();
    let owned: ReplaySession | null = null;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeErrors: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    setState(null);
    setError(null);
    const retire = (cause?: unknown) => {
      if (abort.signal.aborted) return;
      const active = owned;
      owned = null;
      drag.current = null;
      if (session.current === active) {
        session.current = null;
        failSession.current = null;
      }
      abort.abort(cause);
      observer?.disconnect();
      try {
        unsubscribe?.();
      } finally {
        try {
          unsubscribeErrors?.();
        } finally {
          active?.dispose();
        }
      }
    };
    const fail = (
      cause: unknown,
      fallback = "The replay could not be started.",
    ) => {
      if (abort.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : fallback);
      try {
        retire(cause);
      } catch {
        // Keep the original failure visible and allow the user to reload.
      }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      fail(
        new Error(
          "The browser lost its graphics connection. Reload this replay to continue.",
        ),
      );
    };
    target.addEventListener("webglcontextlost", lost, { signal: abort.signal });
    const load = async () => {
      try {
        owned = await initialize(target, abort.signal);
        if (abort.signal.aborted) {
          owned.dispose();
          return;
        }
        session.current = owned;
        failSession.current = fail;
        const subscribedSession = owned;
        unsubscribeErrors = subscribedSession.subscribeErrors((cause) => {
          if (session.current === subscribedSession) fail(cause);
        });
        abort.signal.throwIfAborted();
        const initial = readReplayShareState(
          search,
          owned.getState().durationSeconds,
        );
        const allowed = replayPresentationControls(
          requestedControls.current,
          owned.capabilities,
        );
        setPresentation({
          capabilities: owned.capabilities,
          panning: owned.panCamera !== undefined,
          zooming: owned.adjustCameraZoom !== undefined,
          minimapUrl:
            owned.moveCameraToMap === undefined
              ? undefined
              : owned.capabilities?.minimapUrl,
        });
        owned.pause();
        owned.setPerspective(
          allowed.perspectives.includes(initial.perspective)
            ? initial.perspective
            : "all",
        );
        if (
          initial.participantId !== null &&
          owned
            .getState()
            .participants.some(
              (player) => player.participantId === initial.participantId,
            )
        ) {
          owned.setCamera({
            mode: "follow",
            participantId: initial.participantId,
          });
        }
        if (owned.getState().timeSeconds !== initial.timeSeconds)
          await owned.seek(initial.timeSeconds);
        abort.signal.throwIfAborted();
        unsubscribe = owned.subscribe((next) => {
          if (abort.signal.aborted) return;
          setState(next);
          onState.current?.(next);
        });
        const resize = () => {
          const active = owned;
          if (
            active === null ||
            abort.signal.aborted ||
            session.current !== active ||
            !target.isConnected
          )
            return;
          const bounds = target.getBoundingClientRect();
          const ratio = globalThis.devicePixelRatio;
          if (
            ![bounds.width, bounds.height, ratio].every(
              (value) => Number.isFinite(value) && value > 0,
            )
          )
            return;
          try {
            active.resize(bounds.width, bounds.height, ratio);
          } catch (error_) {
            fail(error_);
          }
        };
        observer = new ResizeObserver(resize);
        observer.observe(target);
        resize();
      } catch (error_) {
        fail(error_);
      }
    };
    void load();
    return () => {
      retire();
    };
  }, [initialize, search, attempt]);

  return (
    <section
      ref={surface}
      className="overflow-hidden rounded-xl border border-scout-border bg-scout-surface text-scout-ink"
      aria-label="Replay player"
      aria-keyshortcuts="1 2 3 4 5 q w e r t"
    >
      <ReplayTeamScore scoreboard={ready ? state.scoreboard : undefined} />
      <div className="relative aspect-video bg-black">
        <ReplayCameraCanvas
          canvas={canvas}
          drag={drag}
          ready={ready}
          freeCamera={freeCamera}
          command={command}
        />
        {ready && props.renderCanvasOverlay?.(state)}
        {ready && (
          <ReplayCameraMinimap
            state={state}
            url={presentation?.minimapUrl}
            command={command}
          />
        )}
        {state === null && error === null && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-black px-6 text-center text-sm text-white"
          >
            Preparing replay…
          </p>
        )}
        {error !== null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-scout-surface px-6 text-center text-scout-ink">
            <p role="alert" className="max-w-xl break-words text-sm">
              {error}
            </p>
            <Button
              onClick={() => {
                setAttempt((previous) => previous + 1);
              }}
            >
              Reload replay
            </Button>
          </div>
        )}
      </div>
      {ready && (
        <>
          <ReplayControls
            state={state}
            controls={controls}
            panning={panning}
            zooming={presentation?.zooming === true}
            onCommand={command}
            {...(props.renderPlaybackControls === undefined
              ? {}
              : { renderPlaybackControls: props.renderPlaybackControls })}
            {...(props.renderTimelineExtras === undefined
              ? {}
              : { renderTimelineExtras: props.renderTimelineExtras })}
          />
          <ReplayRosterScore
            scoreboard={state.scoreboard}
            participants={state.participants}
          />
        </>
      )}
    </section>
  );
}
