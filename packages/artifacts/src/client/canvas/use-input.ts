import { useCallback, useEffect, useRef } from "react";
import type { HostInput } from "#client/viewers/types.ts";
import { panBy, wheelZoomFactor, zoomAt } from "./camera.ts";
import type { CameraController } from "./controller.ts";
import {
  attachGestures,
  type SessionStart,
  type PointerSession,
  type Tap,
  type Tool,
} from "./gestures.ts";
import { createForwardedGestures } from "./pinch.ts";

/** Elements where Space is a character or a click, not the pan modifier. */
const SPACE_OWNERS =
  "input, textarea, select, button, a[href], [contenteditable]";

/**
 * Wires the viewport's pointer, wheel and gesture input to the camera, tracks
 * the Space modifier, and turns input a live frame forwarded over the bridge
 * into camera moves. Returns the bridge's input handler.
 */
export function useCanvasInput({
  controller,
  viewport,
  blanket,
  tool,
  onTap,
  onDoubleTap,
  beginSession,
}: {
  readonly controller: CameraController;
  readonly viewport: HTMLElement | null;
  readonly blanket: HTMLElement | null;
  readonly tool: Tool;
  readonly onTap: (tap: Tap) => void;
  readonly onDoubleTap: (frameId: string) => void;
  readonly beginSession: (start: SessionStart) => PointerSession | null;
}): (input: HostInput) => void {
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const spaceHeld = useRef(false);
  const handlers = useRef({ onTap, onDoubleTap, beginSession });
  handlers.current = { onTap, onDoubleTap, beginSession };

  useEffect(() => {
    if (viewport === null || blanket === null) return;
    return attachGestures({
      viewport,
      blanket,
      controller,
      tool: () => toolRef.current,
      spaceHeld: () => spaceHeld.current,
      onTap: (tap) => {
        handlers.current.onTap(tap);
      },
      onDoubleTap: (id) => {
        handlers.current.onDoubleTap(id);
      },
      beginSession: (start) => handlers.current.beginSession(start),
    });
  }, [viewport, blanket, controller]);

  // Space held means "pan whatever is under the pointer".
  useEffect(() => {
    function set(on: boolean): void {
      spaceHeld.current = on;
      viewport?.setAttribute("data-pan", String(on));
    }
    function down(event: KeyboardEvent): void {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      if ((target?.closest(SPACE_OWNERS) ?? null) !== null) return;
      event.preventDefault();
      set(true);
    }
    function up(event: KeyboardEvent): void {
      if (event.code === "Space") set(false);
    }
    function release(): void {
      set(false);
    }
    globalThis.addEventListener("keydown", down);
    globalThis.addEventListener("keyup", up);
    globalThis.addEventListener("blur", release);
    return () => {
      globalThis.removeEventListener("keydown", down);
      globalThis.removeEventListener("keyup", up);
      globalThis.removeEventListener("blur", release);
      set(false);
    };
  }, [viewport]);

  const forwarded = useRef(createForwardedGestures());
  return useCallback(
    (input: HostInput) => {
      const box = viewport?.getBoundingClientRect();
      if (box === undefined) return;
      const at = { x: input.client.x - box.left, y: input.client.y - box.top };
      const camera = controller.get();
      if (input.type === "wheel") {
        if (input.ctrl)
          controller.moveTo(
            zoomAt(camera, at, wheelZoomFactor(input.dy)),
            "zoom",
          );
        else controller.moveTo(panBy(camera, -input.dx, -input.dy), "pan");
        return;
      }
      controller.moveTo(
        forwarded.current.feed(
          { scale: input.scale, centre: at },
          camera,
          performance.now(),
        ),
        "zoom",
      );
    },
    [controller, viewport],
  );
}
