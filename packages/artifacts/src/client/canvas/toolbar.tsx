import {
  HandIcon,
  MessageSquarePlusIcon,
  MinusIcon,
  PlusIcon,
  ScanIcon,
  ShrinkIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { CameraController } from "./controller.ts";
import type { Tool } from "./gestures.ts";

/** The zoom readout follows the camera without a render per frame. */
function ZoomReadout({
  controller,
  onReset,
}: {
  readonly controller: CameraController;
  readonly onReset: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const show = (): void => {
      const element = ref.current;
      if (element !== null)
        element.textContent = `${String(Math.round(controller.get().s * 100))}%`;
    };
    show();
    return controller.onFrame(show);
  }, [controller]);
  return (
    <button
      ref={ref}
      type="button"
      className="ar-cv-zoom"
      title="Reset zoom to 100% (0)"
      aria-keyshortcuts="0"
      data-testid="zoom-readout"
      onClick={onReset}
    />
  );
}

export function CanvasToolbar({
  controller,
  tool,
  commenting,
  hasSelection,
  onZoom,
  onReset,
  onFitAll,
  onFitSelection,
  onTool,
  onComment,
}: {
  readonly controller: CameraController;
  readonly tool: Tool;
  readonly commenting: boolean;
  readonly hasSelection: boolean;
  readonly onZoom: (factor: number) => void;
  readonly onReset: () => void;
  readonly onFitAll: () => void;
  readonly onFitSelection: () => void;
  readonly onTool: (tool: Tool) => void;
  readonly onComment: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div
      className="ar-cv-toolbar"
      role="toolbar"
      aria-label="Canvas tools"
      data-cv-ignore=""
    >
      <button
        type="button"
        className="ar-icon-button"
        aria-label="Zoom out"
        aria-keyshortcuts="-"
        title="Zoom out (-)"
        onClick={() => {
          onZoom(1 / 1.25);
        }}
      >
        <MinusIcon aria-hidden="true" />
      </button>
      <ZoomReadout controller={controller} onReset={onReset} />
      <button
        type="button"
        className="ar-icon-button"
        aria-label="Zoom in"
        aria-keyshortcuts="+"
        title="Zoom in (+)"
        onClick={() => {
          onZoom(1.25);
        }}
      >
        <PlusIcon aria-hidden="true" />
      </button>
      <span className="ar-cv-sep" aria-hidden="true" />
      <button
        type="button"
        className="ar-icon-button"
        aria-label="Fit all frames"
        aria-keyshortcuts="1"
        title="Fit all (1)"
        onClick={onFitAll}
      >
        <ScanIcon aria-hidden="true" />
      </button>
      <button
        type="button"
        className="ar-icon-button"
        aria-label="Fit the selected frame"
        aria-keyshortcuts="2"
        title="Fit selection (2)"
        disabled={!hasSelection}
        onClick={onFitSelection}
      >
        <ShrinkIcon aria-hidden="true" />
      </button>
      <span className="ar-cv-sep" aria-hidden="true" />
      <button
        type="button"
        className="ar-icon-button"
        aria-label="Hand tool"
        aria-keyshortcuts="H"
        aria-pressed={tool === "hand"}
        title="Hand tool: drag to pan (H)"
        onClick={() => {
          onTool(tool === "hand" ? "select" : "hand");
        }}
      >
        <HandIcon aria-hidden="true" />
      </button>
      <button
        type="button"
        className="ar-icon-button"
        aria-label="Comment mode"
        aria-keyshortcuts="C"
        aria-pressed={commenting}
        data-testid="comment-mode"
        title="Comment mode: click to place a pin (C)"
        onClick={() => {
          onComment(!commenting);
        }}
      >
        <MessageSquarePlusIcon aria-hidden="true" />
      </button>
    </div>
  );
}
