import { useCallback, useRef } from "react";
import type { Camera, WorldRect } from "#client/canvas/camera.ts";
import type { CameraController } from "#client/canvas/controller.ts";
import { useFollowCamera } from "#client/canvas/follow.ts";
import type { PointerSession } from "#client/canvas/gestures.ts";
import type { Point } from "#client/lib/geometry.ts";
import {
  HANDLE_CURSOR,
  HANDLES,
  handlePosition,
  type Handle,
} from "./geometry.ts";

/** The point of a pointer event in the canvas viewport's own coordinates. */
function inViewport(event: React.PointerEvent<HTMLElement>): Point {
  const box = event.currentTarget
    .closest(".ar-cv-viewport")
    ?.getBoundingClientRect();
  return {
    x: event.clientX - (box?.left ?? 0),
    y: event.clientY - (box?.top ?? 0),
  };
}

/**
 * The eight resize handles of the selected frame, on the unscaled overlay. A
 * handle captures its own pointer and runs the resize session the page gives
 * it. They are a pointer affordance only; the keyboard moves frames with the
 * arrow keys.
 */
export function ResizeHandles({
  controller,
  rect,
  start,
}: {
  readonly controller: CameraController;
  readonly rect: WorldRect;
  readonly start: (handle: Handle, point: Point) => PointerSession | null;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const session = useRef<PointerSession | null>(null);
  const place = useCallback(
    (camera: Camera, element: HTMLElement) => {
      element.style.width = `${String(rect.w * camera.s)}px`;
      element.style.height = `${String(rect.h * camera.s)}px`;
      element.style.transform = `translate(${String(camera.x + rect.x * camera.s)}px, ${String(camera.y + rect.y * camera.s)}px)`;
    },
    [rect.x, rect.y, rect.w, rect.h],
  );
  useFollowCamera(controller, ref, place);

  return (
    <div
      ref={ref}
      className="ar-cv-handles"
      data-testid="resize-handles"
      aria-hidden="true"
    >
      {HANDLES.map((handle) => {
        const at = handlePosition(handle);
        return (
          <div
            key={handle}
            className="ar-cv-handle"
            data-cv-ignore=""
            data-handle={handle}
            style={{
              left: `${String(at.x * 100)}%`,
              top: `${String(at.y * 100)}%`,
              cursor: HANDLE_CURSOR[handle],
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              session.current = start(handle, inViewport(event));
            }}
            onPointerMove={(event) => {
              session.current?.move(inViewport(event), {
                altKey: event.altKey,
              });
            }}
            onPointerUp={(event) => {
              session.current?.end(false);
              session.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              session.current?.end(true);
              session.current = null;
            }}
          />
        );
      })}
    </div>
  );
}

/** The rubber band of a marquee drag. */
export function MarqueeBox({
  controller,
  rect,
}: {
  readonly controller: CameraController;
  readonly rect: WorldRect;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const place = useCallback(
    (camera: Camera, element: HTMLElement) => {
      element.style.width = `${String(rect.w * camera.s)}px`;
      element.style.height = `${String(rect.h * camera.s)}px`;
      element.style.transform = `translate(${String(camera.x + rect.x * camera.s)}px, ${String(camera.y + rect.y * camera.s)}px)`;
    },
    [rect.x, rect.y, rect.w, rect.h],
  );
  useFollowCamera(controller, ref, place);
  return (
    <div
      ref={ref}
      className="ar-cv-marquee"
      data-testid="marquee"
      aria-hidden="true"
    />
  );
}
