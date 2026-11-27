import { useCallback, useEffect, useRef, useState } from "react";
import type { Point } from "#client/lib/geometry.ts";
import {
  boundsOf,
  fitRect,
  HOME_CAMERA,
  parseStoredCamera,
  resetZoom,
  serializeCamera,
  visibleRect,
  zoomAt,
  type Camera,
  type Size,
  type WorldRect,
} from "./camera.ts";
import {
  createCameraController,
  type CameraController,
  type MotionKind,
} from "./controller.ts";
import type { CanvasFrameModel } from "./model.ts";
import { adaptPreviewCap, initialPreviewCap } from "./tiers.ts";

const CAMERA_KEY = "artifacts.canvas.camera.v1";
const FIT_PADDING = 64;
/** The most a fitted selection zooms in; fit-all never goes past 100 %. */
const FIT_SELECTION_MAX_SCALE = 2;
/** One step of the toolbar and the +/- keys. */
export const ZOOM_STEP = 1.25;

function storedCamera(slug: string): Camera | null {
  try {
    return parseStoredCamera(localStorage.getItem(`${CAMERA_KEY}:${slug}`));
  } catch {
    return null;
  }
}

function storeCamera(slug: string, camera: Camera): void {
  try {
    localStorage.setItem(`${CAMERA_KEY}:${slug}`, serializeCamera(camera));
  } catch {
    // Private windows and blocked storage just forget the camera.
  }
}

export type SettledCamera = {
  readonly camera: Camera;
  readonly kind: MotionKind;
};

export type CanvasCamera = {
  readonly controller: CameraController;
  readonly viewport: HTMLDivElement | null;
  readonly setViewport: (element: HTMLDivElement | null) => void;
  readonly setWorld: (element: HTMLDivElement | null) => void;
  readonly size: Size;
  readonly sizeRef: { readonly current: Size };
  /** The camera as of the last settle: what React renders from. */
  readonly settled: SettledCamera;
  /** How many inert previews may be mounted at once. */
  readonly cap: number;
  readonly fitAll: () => void;
  readonly fitSelection: () => void;
  readonly zoomBy: (factor: number) => void;
  readonly reset: () => void;
  /** Pans (never zooms) until `rect` is inside the view. */
  readonly reveal: (rect: WorldRect) => void;
  readonly viewportCentre: () => Point;
};

/**
 * The camera of one board: the controller, the measured viewport, the settled
 * camera React renders from, the adaptive preview cap, and the commands (fit,
 * zoom, reveal). The camera is stored per board and restored on the next visit;
 * a board nobody has looked at starts fitted to its frames.
 */
export function useCanvasCamera(
  slug: string,
  frames: readonly CanvasFrameModel[],
  selected: readonly CanvasFrameModel[],
  insetRight = 0,
): CanvasCamera {
  const restored = useRef(storedCamera(slug));
  const [controller] = useState(() =>
    createCameraController(restored.current ?? HOME_CAMERA),
  );
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [world, setWorld] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  // The part of the viewport something floats over (the open comments panel):
  // fitting and revealing aim at what is left.
  const insetRef = useRef(insetRight);
  insetRef.current = insetRight;
  const usable = useCallback(
    (): Size => ({
      width: Math.max(1, sizeRef.current.width - insetRef.current),
      height: sizeRef.current.height,
    }),
    [],
  );
  const [settled, setSettled] = useState<SettledCamera>({
    camera: controller.get(),
    kind: "pan",
  });
  const [cap, setCap] = useState(() => initialPreviewCap(navigator.userAgent));

  useEffect(() => {
    if (world === null) return;
    return controller.attach(world);
  }, [controller, world]);

  useEffect(() => {
    if (viewport === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, [viewport]);

  useEffect(
    () =>
      controller.onSettle((camera, info) => {
        setSettled({ camera, kind: info.kind });
        setCap((current) => adaptPreviewCap(current, info.frameTimes));
        storeCamera(slug, camera);
      }),
    [controller, slug],
  );

  const move = useCallback(
    (camera: Camera) => {
      controller.moveTo(camera, "pan");
    },
    [controller],
  );

  const fitAll = useCallback(() => {
    const bounds = boundsOf(frames.map((frame) => frame.rect));
    if (bounds === null || sizeRef.current.width === 0) return;
    move(fitRect(bounds, usable(), { padding: FIT_PADDING, maxScale: 1 }));
  }, [frames, move, usable]);

  const initialised = useRef(restored.current !== null);
  useEffect(() => {
    if (initialised.current || size.width === 0 || frames.length === 0) return;
    initialised.current = true;
    fitAll();
  }, [size.width, frames.length, fitAll]);

  const fitSelection = useCallback(() => {
    const bounds = boundsOf(selected.map((frame) => frame.rect));
    if (bounds === null || sizeRef.current.width === 0) return;
    move(
      fitRect(bounds, usable(), {
        padding: FIT_PADDING,
        maxScale: FIT_SELECTION_MAX_SCALE,
      }),
    );
  }, [selected, move, usable]);

  const viewportCentre = useCallback(
    (): Point => ({
      x: sizeRef.current.width / 2,
      y: sizeRef.current.height / 2,
    }),
    [],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      controller.moveTo(
        zoomAt(controller.get(), viewportCentre(), factor),
        "zoom",
      );
    },
    [controller, viewportCentre],
  );

  const reset = useCallback(() => {
    controller.moveTo(resetZoom(controller.get(), sizeRef.current), "zoom");
  }, [controller]);

  const reveal = useCallback(
    (rect: WorldRect) => {
      const camera = controller.get();
      const view = visibleRect(camera, sizeRef.current);
      const inside =
        rect.x >= view.x &&
        rect.y >= view.y &&
        rect.x + rect.w <= view.x + view.w &&
        rect.y + rect.h <= view.y + view.h;
      if (inside) return;
      move({
        s: camera.s,
        x: usable().width / 2 - (rect.x + rect.w / 2) * camera.s,
        y: sizeRef.current.height / 2 - (rect.y + rect.h / 2) * camera.s,
      });
    },
    [controller, move, usable],
  );

  return {
    controller,
    viewport,
    setViewport,
    setWorld,
    size,
    sizeRef,
    settled,
    cap,
    fitAll,
    fitSelection,
    zoomBy,
    reset,
    reveal,
    viewportCentre,
  };
}
