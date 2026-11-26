import { useEffect, useMemo, useRef, useState } from "react";
import {
  clamp,
  contains,
  denormalizeInRect,
  normalizeInRect,
} from "#client/lib/geometry.ts";
import {
  contentFileUrl,
  type AnchorAdapter,
  type ViewerProps,
} from "./types.ts";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

type View = { readonly scale: number; readonly x: number; readonly y: number };
const HOME: View = { scale: 1, x: 0, y: 0 };

/**
 * Zoom around a client point: the point under the cursor stays under it.
 * `origin` is the image box's center before any transform.
 */
export function zoomAt(
  view: View,
  factor: number,
  cursor: { x: number; y: number },
  origin: { x: number; y: number },
): View {
  const scale = clamp(view.scale * factor, MIN_ZOOM, MAX_ZOOM);
  if (scale === MIN_ZOOM) return HOME;
  const ratio = scale / view.scale;
  return {
    scale,
    x: cursor.x - origin.x - (cursor.x - origin.x - view.x) * ratio,
    y: cursor.y - origin.y - (cursor.y - origin.y - view.y) * ratio,
  };
}

export function ImageViewer({
  artifact,
  version,
  mode,
  adapterRef,
  onViewChange,
}: ViewerProps): React.JSX.Element {
  const imageRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(HOME);
  const viewRef = useRef(view);
  viewRef.current = view;
  const src = contentFileUrl(version, version.entryPath);

  const adapter = useMemo<AnchorAdapter>(
    () => ({
      toAnchor(point) {
        const image = imageRef.current;
        if (image === null) return null;
        const rect = image.getBoundingClientRect();
        if (!contains(rect, point)) return null;
        const unit = normalizeInRect(rect, point);
        return unit === null ? null : { type: "frame", x: unit.x, y: unit.y };
      },
      toClient(anchor) {
        const image = imageRef.current;
        return image === null || anchor.type !== "frame"
          ? null
          : denormalizeInRect(image.getBoundingClientRect(), anchor);
      },
    }),
    [],
  );

  useEffect(() => {
    adapterRef.current = adapter;
    onViewChange();
    return () => {
      adapterRef.current = null;
    };
  }, [adapter, adapterRef, onViewChange]);

  useEffect(() => {
    onViewChange();
  }, [view, onViewChange]);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null || mode !== "focus") return;
    // Non-passive: the wheel zooms the image instead of scrolling the page.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      setView((current) =>
        zoomAt(
          current,
          Math.exp(-event.deltaY * 0.002),
          { x: event.clientX, y: event.clientY },
          { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        ),
      );
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      box.removeEventListener("wheel", onWheel);
    };
  }, [mode]);

  if (src === null)
    return <p className="ar-note">This version’s files were deleted.</p>;

  function pan(event: React.PointerEvent<HTMLDivElement>): void {
    if (viewRef.current.scale === 1 || event.buttons !== 1) return;
    const movement = { x: event.movementX, y: event.movementY };
    setView((current) => ({
      scale: current.scale,
      x: current.x + movement.x,
      y: current.y + movement.y,
    }));
  }

  return (
    <div
      className="ar-image"
      ref={boxRef}
      data-zoomed={view.scale > 1}
      onPointerMove={pan}
      onDoubleClick={() => {
        setView(HOME);
      }}
    >
      <img
        ref={imageRef}
        src={src}
        alt={artifact.title}
        draggable={false}
        style={{
          transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})`,
        }}
        onLoad={onViewChange}
      />
      {mode === "focus" ? (
        <div className="ar-zoom-controls" role="group" aria-label="Zoom">
          <button
            type="button"
            className="ui-btn"
            aria-label="Zoom in"
            onClick={() => {
              const rect = boxRef.current?.getBoundingClientRect();
              if (rect === undefined) return;
              const center = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
              };
              setView((current) => zoomAt(current, 1.5, center, center));
            }}
          >
            +
          </button>
          <button
            type="button"
            className="ui-btn"
            aria-label="Zoom out"
            onClick={() => {
              const rect = boxRef.current?.getBoundingClientRect();
              if (rect === undefined) return;
              const center = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
              };
              setView((current) => zoomAt(current, 1 / 1.5, center, center));
            }}
          >
            −
          </button>
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              setView(HOME);
            }}
          >
            Fit
          </button>
        </div>
      ) : null}
    </div>
  );
}
