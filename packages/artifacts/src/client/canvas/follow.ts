import { useLayoutEffect, type RefObject } from "react";
import type { Camera } from "./camera.ts";
import type { CameraController } from "./controller.ts";

/**
 * Keeps an overlay element glued to the world as the camera moves. `place`
 * writes the element's transform from the camera; it runs once when the
 * element mounts and again after every frame the camera is written, never
 * through React state. Pass a `place` that is stable between renders (or
 * changes only when what it positions changes).
 */
export function useFollowCamera(
  controller: CameraController,
  ref: RefObject<HTMLElement | null>,
  place: (camera: Camera, element: HTMLElement) => void,
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const run = (camera: Camera): void => {
      place(camera, element);
    };
    run(controller.get());
    return controller.onFrame(run);
  }, [controller, ref, place]);
}
