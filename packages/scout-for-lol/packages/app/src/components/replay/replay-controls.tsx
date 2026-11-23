import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type {
  ReplayMapPoint,
  ReplayPerspective,
  ReplayPresentationCapabilities,
  ReplaySession,
  ReplaySessionState,
} from "@scout-for-lol/replay";
import { Button } from "@scout-for-lol/design-system/components/button";
import { replayClock } from "#src/lib/replay/share-state.ts";
import { ReplayEventJump } from "./replay-event-jump.tsx";

export type ReplayPresentationControls = {
  rates: readonly number[];
  perspectives: readonly ReplayPerspective[];
  directedCamera: boolean;
  announcerPreview?: ReplayPresentationCapabilities["announcerPreview"];
  timelineEvents?: ReplayPresentationCapabilities["timelineEvents"];
  unitVisibility?: ReplayPresentationCapabilities["unitVisibility"];
};

const nativeControls: ReplayPresentationControls = {
  rates: [0.25, 0.5, 1, 2, 4, 8],
  perspectives: ["all", "blue", "red"],
  directedCamera: true,
};

export function replayPresentationControls(
  controls = nativeControls,
  capabilities?: ReplayPresentationCapabilities,
): ReplayPresentationControls {
  if (capabilities === undefined) return controls;
  return {
    rates: controls.rates.filter(
      (rate) => capabilities.rates?.includes(rate) ?? true,
    ),
    perspectives: controls.perspectives.filter((perspective) =>
      capabilities.perspectives.includes(perspective),
    ),
    directedCamera: controls.directedCamera && capabilities.directedCamera,
    timelineEvents: capabilities.timelineEvents,
    unitVisibility: capabilities.unitVisibility,
    ...(capabilities.announcerPreview === undefined
      ? {}
      : { announcerPreview: capabilities.announcerPreview }),
  };
}

export type ReplayPlaybackControlsProps = {
  state: ReplaySessionState;
  controls: ReplayPresentationControls;
  onCommand: (
    action: (active: ReplaySession) => void | Promise<void>,
  ) => Promise<void>;
};

export function ReplayControls(props: {
  state: ReplaySessionState;
  controls?: ReplayPresentationControls;
  panning?: boolean;
  zooming?: boolean;
  renderPlaybackControls?: (props: ReplayPlaybackControlsProps) => ReactNode;
  renderTimelineExtras?: (
    state: ReplaySessionState,
    seek: (timeSeconds: number) => Promise<void>,
  ) => ReactNode;
  onCommand: (
    action: (active: ReplaySession) => void | Promise<void>,
  ) => Promise<void>;
}) {
  const id = useId();
  const { state } = props;
  const cameraView = state.cameraView;
  const controls = props.controls ?? nativeControls;
  const [requestedTime, setRequestedTime] = useState<number | null>(null);
  const [sound, setSound] = useState<"off" | "loading" | "on" | "unavailable">(
    "off",
  );
  const pendingSeek = useRef<number | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
      pendingSeek.current = null;
    },
    [],
  );
  const seek = async (target: number, mapPoint?: ReplayMapPoint) => {
    if (
      !Number.isFinite(target) ||
      target < 0 ||
      target > state.durationSeconds ||
      pendingSeek.current === target
    )
      return;
    const request = ++generation.current;
    pendingSeek.current = target;
    setRequestedTime(target);
    await props.onCommand(async (active) => {
      await active.seek(target);
      if (mapPoint !== undefined && generation.current === request)
        active.moveCameraToMap?.(mapPoint);
    });
    if (generation.current === request) {
      pendingSeek.current = null;
      setRequestedTime(null);
    }
  };
  const displayTime = requestedTime ?? state.timeSeconds;
  // Keep the last regular tenth seekable when the replay ends between ticks.
  const sliderTicks = Math.ceil(state.durationSeconds * 10);
  const sliderMaximum = sliderTicks / 10;
  const sliderValue =
    displayTime === state.durationSeconds
      ? sliderMaximum
      : Math.min(displayTime, (sliderTicks - 1) / 10);
  return (
    <fieldset className="flex flex-wrap items-end gap-4 border-t border-scout-border bg-scout-surface p-4 text-scout-ink">
      <legend className="sr-only">Replay controls</legend>
      {props.renderPlaybackControls === undefined ? (
        <Button
          onClick={() => {
            void props.onCommand((active) => {
              if (state.playing) active.pause();
              else active.play();
            });
          }}
        >
          {state.playing ? "Pause" : "Play"}
        </Button>
      ) : (
        props.renderPlaybackControls({
          state,
          controls,
          onCommand: props.onCommand,
        })
      )}
      <div className="min-w-48 flex-1 space-y-1">
        <label
          htmlFor={`${id}-time`}
          className="flex justify-between gap-3 text-xs text-scout-subtle"
        >
          <span>Replay time</span>
          <span className="tabular-nums">
            {replayClock(displayTime)} / {replayClock(state.durationSeconds)}
          </span>
        </label>
        <input
          id={`${id}-time`}
          type="range"
          min="0"
          max={sliderMaximum}
          step="0.1"
          value={sliderValue}
          className="w-full accent-scout-brand"
          aria-valuetext={replayClock(displayTime)}
          aria-busy={requestedTime !== null}
          onChange={(event) => {
            const target = Math.min(
              event.currentTarget.valueAsNumber,
              state.durationSeconds,
            );
            void seek(target);
          }}
          onKeyDown={(event) => {
            if (event.key !== "End") return;
            event.preventDefault();
            void seek(state.durationSeconds);
          }}
        />
      </div>
      {props.renderPlaybackControls === undefined && (
        <label
          htmlFor={`${id}-speed`}
          className="space-y-1 text-xs text-scout-subtle"
        >
          <span className="block">Speed</span>
          <select
            id={`${id}-speed`}
            value={state.rate}
            className="rounded-md border border-scout-border bg-scout-canvas p-2 text-sm text-scout-ink"
            onChange={(event) => {
              const rate = Number(event.target.value);
              if (controls.rates.includes(rate))
                void props.onCommand((active) => {
                  active.setRate(rate);
                });
            }}
          >
            {controls.rates.map((rate) => (
              <option key={rate} value={rate}>
                {rate.toString()}×
              </option>
            ))}
          </select>
        </label>
      )}
      <label
        htmlFor={`${id}-vision`}
        className="space-y-1 text-xs text-scout-subtle"
      >
        <span className="block">
          {controls.unitVisibility === true ? "Unit visibility" : "Vision"}
        </span>
        <select
          id={`${id}-vision`}
          value={state.perspective}
          disabled={controls.perspectives.length === 1}
          className="rounded-md border border-scout-border bg-scout-canvas p-2 text-sm text-scout-ink"
          onChange={(event) => {
            const value = event.target.value;
            if (
              (value === "all" || value === "blue" || value === "red") &&
              controls.perspectives.includes(value)
            )
              void props.onCommand((active) => {
                active.setPerspective(value);
              });
          }}
        >
          {controls.perspectives.map((perspective) => (
            <option key={perspective} value={perspective}>
              {perspective === "all"
                ? "All vision"
                : perspective === "blue"
                  ? "Blue team"
                  : "Red team"}
            </option>
          ))}
        </select>
      </label>
      <label
        htmlFor={`${id}-camera`}
        className="space-y-1 text-xs text-scout-subtle"
      >
        <span className="block">Camera</span>
        <select
          id={`${id}-camera`}
          value={
            state.camera.mode === "follow"
              ? `player:${state.camera.participantId?.toString() ?? ""}`
              : state.camera.mode
          }
          className="max-w-60 rounded-md border border-scout-border bg-scout-canvas p-2 text-sm text-scout-ink"
          onChange={(event) => {
            const value = event.target.value;
            if (
              value === "free" ||
              (value === "directed" && controls.directedCamera)
            )
              void props.onCommand((active) => {
                active.setCamera({ mode: value });
              });
            else if (value.startsWith("player:")) {
              const participantId = Number(value.slice("player:".length));
              if (
                state.participants.some(
                  (player) => player.participantId === participantId,
                )
              )
                void props.onCommand((active) => {
                  active.setCamera({ mode: "follow", participantId });
                });
            }
          }}
        >
          <option value="free">Free camera</option>
          {controls.directedCamera && (
            <option value="directed">Directed camera</option>
          )}
          {state.participants.map((player) => (
            <option
              key={player.participantId}
              value={`player:${player.participantId.toString()}`}
            >
              {player.name} · {player.championName}
            </option>
          ))}
        </select>
      </label>
      {props.zooming === true && cameraView !== undefined && (
        <div role="group" aria-label="Camera zoom" className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            aria-disabled={cameraView.zoomStep === 0}
            className="aria-disabled:opacity-50"
            onClick={() => {
              if (cameraView.zoomStep === 0) return;
              void props.onCommand((active) => active.adjustCameraZoom?.(-1));
            }}
          >
            Zoom out
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-disabled={cameraView.zoomStep === cameraView.maxZoomStep}
            className="aria-disabled:opacity-50"
            onClick={() => {
              if (cameraView.zoomStep === cameraView.maxZoomStep) return;
              void props.onCommand((active) => active.adjustCameraZoom?.(1));
            }}
          >
            Zoom in
          </Button>
        </div>
      )}
      {props.panning === true && (
        <Button
          variant="outline"
          onClick={() => {
            void props.onCommand((active) => {
              active.setCamera({ mode: "free" });
            });
          }}
        >
          Map overview
        </Button>
      )}
      {controls.announcerPreview === "female1-en-us" && (
        <div>
          <Button
            type="button"
            variant="outline"
            aria-pressed={sound === "on"}
            aria-busy={sound === "loading"}
            aria-disabled={sound === "loading"}
            onClick={() => {
              if (sound === "loading") return;
              const enable = sound !== "on";
              setSound("loading");
              void props.onCommand(async (active) => {
                if (active.setAnnouncerPreview === undefined) {
                  setSound("unavailable");
                  return;
                }
                try {
                  await active.setAnnouncerPreview(enable);
                  setSound(enable ? "on" : "off");
                } catch {
                  setSound("unavailable");
                }
              });
            }}
          >
            Announcer preview (Female1 English)
          </Button>
          {sound === "unavailable" && (
            <p role="status" className="text-xs text-scout-subtle">
              Announcer preview could not start.
            </p>
          )}
        </div>
      )}
      <ReplayEventJump events={controls.timelineEvents} seek={seek} />
      {props.renderTimelineExtras?.(state, seek)}
    </fieldset>
  );
}
