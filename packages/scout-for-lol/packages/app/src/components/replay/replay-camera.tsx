import type { Ref, RefObject } from "react";
import type { ReplaySession, ReplaySessionState } from "@scout-for-lol/replay";
import { ReplayMinimap } from "./replay-minimap.tsx";
import type { ReplayPlaybackControlsProps } from "./replay-controls.tsx";

const cameraKeys = new Map<string, readonly [number, number]>([
  ["ArrowLeft", [48, 0]],
  ["ArrowRight", [-48, 0]],
  ["ArrowUp", [0, 48]],
  ["ArrowDown", [0, -48]],
]);

export type ReplayCameraDrag = { id: number; x: number; y: number };

export function ReplayCameraCanvas({
  canvas,
  drag,
  ready,
  freeCamera,
  command,
}: {
  canvas: Ref<HTMLCanvasElement>;
  drag: RefObject<ReplayCameraDrag | null>;
  ready: boolean;
  freeCamera: boolean;
  command: ReplayPlaybackControlsProps["onCommand"];
}) {
  const pan = (deltaX: number, deltaY: number) =>
    command((active) => {
      active.panCamera?.(deltaX, deltaY);
    });

  return (
    <canvas
      ref={canvas}
      tabIndex={ready ? 0 : -1}
      className={`h-full w-full${freeCamera ? " cursor-grab touch-none active:cursor-grabbing" : ""}`}
      aria-label="League of Legends replay scene"
      aria-description={
        freeCamera ? "Drag or use the arrow keys to pan." : undefined
      }
      aria-keyshortcuts={
        freeCamera ? "ArrowLeft ArrowRight ArrowUp ArrowDown Home" : undefined
      }
      onPointerDown={(event) => {
        if (ready) event.currentTarget.focus({ preventScroll: true });
        if (!freeCamera || event.button !== 0 || drag.current !== null) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const previous = drag.current;
        if (!freeCamera || previous?.id !== event.pointerId) return;
        const deltaX = event.clientX - previous.x;
        const deltaY = event.clientY - previous.y;
        previous.x = event.clientX;
        previous.y = event.clientY;
        if (deltaX !== 0 || deltaY !== 0) void pan(deltaX, deltaY);
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.id === event.pointerId) drag.current = null;
      }}
      onKeyDown={(event) => {
        if (
          !freeCamera ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        if (event.key === "Home") {
          event.preventDefault();
          void command(resetCamera);
        }
        const shift = cameraKeys.get(event.key);
        if (shift !== undefined) {
          event.preventDefault();
          void pan(...shift);
        }
      }}
    />
  );
}

function resetCamera(active: ReplaySession) {
  active.setCamera({ mode: "free" });
}

export function ReplayCameraMinimap({
  state,
  url,
  command,
}: {
  state: ReplaySessionState;
  url: string | undefined;
  command: ReplayPlaybackControlsProps["onCommand"];
}) {
  if (url === undefined || state.cameraView === undefined) return null;
  return (
    <ReplayMinimap
      url={url}
      point={state.cameraView.mapPoint}
      actors={state.mapActors}
      onMove={(point) => {
        void command((active) => {
          active.moveCameraToMap?.(point);
        });
      }}
      onReset={() => {
        void command(resetCamera);
      }}
    />
  );
}
