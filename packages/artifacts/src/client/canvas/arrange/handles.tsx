import { useCallback, useRef } from "react";
import type { Camera, WorldRect } from "#client/canvas/camera.ts";
import type { CameraController } from "#client/canvas/controller.ts";
import { useFollowCamera, useFollowRect } from "#client/canvas/follow.ts";
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
 * Pointer handlers that run a drag session started by `start`: the handle
 * captures its pointer, moves feed the session and it ends on up or cancel.
 */
function useHandleDrag<Key>(
  start: (key: Key, point: Point) => PointerSession | null,
): (key: Key) => React.HTMLAttributes<HTMLDivElement> {
  const session = useRef<PointerSession | null>(null);
  return (key) => ({
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      session.current = start(key, inViewport(event));
    },
    onPointerMove: (event) => {
      session.current?.move(inViewport(event), { altKey: event.altKey });
    },
    onPointerUp: (event) => {
      session.current?.end(false);
      session.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => {
      session.current?.end(true);
      session.current = null;
    },
  });
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
  const drag = useHandleDrag(start);
  useFollowRect(controller, ref, rect);

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
            {...drag(handle)}
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
  useFollowRect(controller, ref, rect);
  return (
    <div
      ref={ref}
      className="ar-cv-marquee"
      data-testid="marquee"
      aria-hidden="true"
    />
  );
}

/** The two ends of a selected line or arrow: each is dragged on its own. */
export function EndpointHandles({
  controller,
  from,
  to,
  start,
}: {
  readonly controller: CameraController;
  readonly from: Point;
  readonly to: Point;
  readonly start: (end: "start" | "end", point: Point) => PointerSession | null;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useHandleDrag(start);
  const place = useCallback(
    (camera: Camera, element: HTMLElement) => {
      element.style.transform = `translate(${String(camera.x)}px, ${String(camera.y)}px)`;
      const ends = element.querySelectorAll<HTMLElement>("[data-endpoint]");
      for (const handle of ends) {
        const at = handle.dataset["endpoint"] === "start" ? from : to;
        handle.style.left = `${String(at.x * camera.s)}px`;
        handle.style.top = `${String(at.y * camera.s)}px`;
      }
    },
    [from, to],
  );
  useFollowCamera(controller, ref, place);

  return (
    <div
      ref={ref}
      className="ar-cv-handles"
      data-testid="endpoint-handles"
      aria-hidden="true"
    >
      {(["start", "end"] as const).map((end) => (
        <div
          key={end}
          className="ar-cv-handle"
          data-cv-ignore=""
          data-endpoint={end}
          style={{ cursor: "move", borderRadius: "50%" }}
          {...drag(end)}
        />
      ))}
    </div>
  );
}
