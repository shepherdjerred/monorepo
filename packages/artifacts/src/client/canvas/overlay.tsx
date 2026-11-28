/**
 * The unscaled layer above the world: frame chips, the selection ring, the
 * Exit chip. Each item follows the camera through `useFollowCamera`, so
 * panning moves them without a React render, and zooming never scales them.
 */
import { LogOutIcon, MaximizeIcon } from "lucide-react";
import { useCallback, useRef } from "react";
import { Link } from "react-router";
import type { Camera, WorldRect } from "./camera.ts";
import type { CameraController } from "./controller.ts";
import { useFollowCamera, useFollowRect } from "./follow.ts";
import type { CanvasFrameModel } from "./model.ts";
import { KIND_LABEL } from "./placeholder.tsx";

const CHIP_HEIGHT = 28;
const CHIP_GAP = 4;
/** A chip never shrinks below this, so a tiny frame still has a readable, focusable name. */
const MIN_CHIP_WIDTH = 72;
/** Below this width a chip shows only the frame's name. */
const COMPACT_CHIP_WIDTH = 180;

export function chipLabel(model: CanvasFrameModel): string {
  const { summary } = model;
  const parts = [summary.title, KIND_LABEL[summary.kind]];
  if (summary.currentVersion !== null)
    parts.push(`version ${String(summary.currentVersion.number)}`);
  parts.push(
    `${String(summary.openThreadCount)} open ${summary.openThreadCount === 1 ? "thread" : "threads"}`,
  );
  return parts.join(", ");
}

export function FrameChip({
  controller,
  model,
  selected,
  active,
  onSelect,
  onActivate,
  onFocusFrame,
}: {
  readonly controller: CameraController;
  readonly model: CanvasFrameModel;
  readonly selected: boolean;
  readonly active: boolean;
  readonly onSelect: (id: string) => void;
  readonly onActivate: (id: string) => void;
  readonly onFocusFrame: (id: string) => void;
}): React.JSX.Element {
  const { rect, summary } = model;
  const ref = useRef<HTMLDivElement>(null);
  const place = useCallback(
    (camera: Camera, element: HTMLElement) => {
      const width = Math.max(MIN_CHIP_WIDTH, rect.w * camera.s);
      element.style.width = `${String(width)}px`;
      // A narrow chip keeps only its name; the tags and link return with room.
      element.dataset["compact"] = String(width < COMPACT_CHIP_WIDTH);
      element.style.transform = `translate(${String(camera.x + rect.x * camera.s)}px, ${String(camera.y + rect.y * camera.s - CHIP_HEIGHT - CHIP_GAP)}px)`;
    },
    [rect.x, rect.y, rect.w],
  );
  useFollowCamera(controller, ref, place);

  return (
    <div
      ref={ref}
      className="ar-cv-chip"
      data-cv-ignore=""
      data-frame-chip={summary.id}
      data-testid="frame-chip"
      data-selected={selected}
      data-active={active}
    >
      <button
        type="button"
        className="ar-cv-chip-main"
        aria-label={chipLabel(model)}
        aria-pressed={selected}
        aria-keyshortcuts="Enter"
        onFocus={() => {
          onSelect(summary.id);
          onFocusFrame(summary.id);
        }}
        onClick={() => {
          onSelect(summary.id);
        }}
        onKeyDown={(event) => {
          if (event.key === " ") {
            // Space is the pan modifier here, not a click.
            event.preventDefault();
          } else if (event.key === "Enter" && summary.kind !== "file") {
            event.preventDefault();
            onActivate(summary.id);
          }
        }}
      >
        <span className="ar-cv-chip-title">{summary.title}</span>
      </button>
      {summary.currentVersion === null ? null : (
        <span className="ar-tag">{`v${String(summary.currentVersion.number)}`}</span>
      )}
      {summary.openThreadCount > 0 ? (
        <span
          className="ar-tag"
          data-tone="amber"
          title={`${String(summary.openThreadCount)} open`}
        >
          {summary.openThreadCount}
        </span>
      ) : null}
      <Link
        className="ar-icon-button"
        to={`/a/${summary.id}`}
        aria-label={`Open ${summary.title} full size`}
      >
        <MaximizeIcon aria-hidden="true" />
      </Link>
    </div>
  );
}

/** The ring around the selected frame; it turns solid while the frame is live. */
export function SelectionRing({
  controller,
  model,
  active,
}: {
  readonly controller: CameraController;
  readonly model: { readonly rect: WorldRect };
  readonly active: boolean;
}): React.JSX.Element {
  const { rect } = model;
  const ref = useRef<HTMLDivElement>(null);
  useFollowRect(controller, ref, rect);
  return (
    <div
      ref={ref}
      className="ar-cv-ring"
      data-testid="selection-ring"
      data-active={active}
      aria-hidden="true"
    />
  );
}

/** The Exit chip at the top-right corner inside the live frame, never scaled. */
export function ExitChip({
  controller,
  model,
  onExit,
}: {
  readonly controller: CameraController;
  readonly model: CanvasFrameModel;
  readonly onExit: () => void;
}): React.JSX.Element {
  const { rect } = model;
  const ref = useRef<HTMLDivElement>(null);
  const place = useCallback(
    (camera: Camera, element: HTMLElement) => {
      const right = camera.x + (rect.x + rect.w) * camera.s;
      element.style.transform = `translate(${String(right - 10)}px, ${String(camera.y + rect.y * camera.s + 10)}px)`;
    },
    [rect.x, rect.y, rect.w],
  );
  useFollowCamera(controller, ref, place);
  return (
    <div ref={ref} className="ar-cv-exit" data-cv-ignore="">
      <button
        type="button"
        className="ar-exit-chip"
        aria-keyshortcuts="Escape"
        data-testid="exit-live"
        onClick={onExit}
      >
        <LogOutIcon aria-hidden="true" />
        Exit <kbd>Esc</kbd>
      </button>
    </div>
  );
}
