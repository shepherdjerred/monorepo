import type { CameraController } from "./controller.ts";
import type { CanvasPin, CanvasFrameModel } from "./model.ts";
import type { WorldRect } from "./camera.ts";
import { MarqueeBox, ResizeHandles } from "./arrange/handles.tsx";
import type { useArrangeSessions } from "./arrange/use-sessions.ts";
import { NoteOverlay } from "./notes/note-parts.tsx";
import type { NoteModel } from "./notes/shapes.ts";
import type { useNotes } from "./notes/use-notes.ts";
import { ExitChip, FrameChip, SelectionRing } from "./overlay.tsx";
import { PinsLayer } from "./pins-layer.tsx";
import { ToolPill, ZoomPill, type ToolButton } from "./toolbar.tsx";
import type { CanvasCamera } from "./use-camera.ts";
import type { FrameTiers } from "./use-tiers.ts";
import type { AnchorAdapter } from "#client/viewers/types.ts";

type Props = {
  readonly controller: CameraController;
  readonly camera: CanvasCamera;
  readonly viewport: HTMLElement | null;
  readonly tiers: FrameTiers;
  readonly sessions: ReturnType<typeof useArrangeSessions>;
  readonly notes: ReturnType<typeof useNotes>;
  readonly inReadingOrder: readonly CanvasFrameModel[];
  readonly byId: ReadonlyMap<string, CanvasFrameModel>;
  readonly selection: ReadonlySet<string>;
  readonly selectedFrames: readonly CanvasFrameModel[];
  readonly selectedNotes: readonly NoteModel[];
  /** The one item a resize can act on (a frame, a box or a sticky), if exactly one is selected. */
  readonly resizable:
    { readonly id: string; readonly rect: WorldRect } | undefined;
  readonly activeId: string | null;
  readonly activeFrame: CanvasFrameModel | undefined;
  readonly commentMode: boolean;
  readonly marquee: WorldRect | null;
  readonly toolGroups: readonly (readonly ToolButton[])[];
  readonly pins: readonly CanvasPin[];
  readonly rects: ReadonlyMap<string, WorldRect>;
  readonly adapters: ReadonlyMap<string, { current: AnchorAdapter | null }>;
  readonly tick: number;
  readonly selectedThreadId: string | null;
  readonly onSelectThread: (threadId: string | null) => void;
  readonly onSelectFrame: (id: string) => void;
  readonly onActivate: (id: string) => void;
  readonly onDeactivate: () => void;
};

/** The unscaled layer: chips, selection, handles, editors, pins and the tool pills. */
export function CanvasOverlay(props: Props): React.JSX.Element {
  const { controller, camera, notes, sessions, selection } = props;
  const { resizable } = props;
  return (
    <div className="ar-cv-overlay" data-testid="canvas-overlay">
      <div
        className="ar-cv-chips"
        role="group"
        aria-label="Frames in reading order"
      >
        {props.inReadingOrder.map((frame) => (
          <FrameChip
            key={frame.id}
            controller={controller}
            model={frame}
            selected={selection.has(frame.id)}
            active={frame.id === props.activeId}
            onSelect={props.onSelectFrame}
            onActivate={props.onActivate}
            onFocusFrame={(id) => {
              const target = props.byId.get(id);
              if (target !== undefined) camera.reveal(target.rect);
            }}
          />
        ))}
      </div>
      {props.selectedFrames.map((frame) => (
        <SelectionRing
          key={frame.id}
          controller={controller}
          model={frame}
          active={frame.id === props.activeId}
        />
      ))}
      {props.selectedNotes.map((model) => (
        <SelectionRing
          key={model.id}
          controller={controller}
          model={model}
          active={false}
        />
      ))}
      {resizable === undefined ||
      props.commentMode ||
      resizable.id === props.activeId ? null : (
        <ResizeHandles
          key={resizable.id}
          controller={controller}
          rect={resizable.rect}
          start={(handle, point) =>
            sessions.startResize(resizable.id, handle, point)
          }
        />
      )}
      <NoteOverlay
        controller={controller}
        editing={notes.editing}
        onCommit={notes.commitText}
        onCancel={notes.cancelText}
        onlyNote={selection.size === 1 ? notes.onlyNote : undefined}
        startEndpoint={sessions.startEndpoint}
        palette={{
          shown: notes.paletteShown && !props.commentMode,
          color: notes.shownColor,
          titleSize: notes.titleSize,
          onColor: notes.applyColor,
          onTitleSize: notes.applyTitleSize,
        }}
      />
      {props.marquee === null ? null : (
        <MarqueeBox controller={controller} rect={props.marquee} />
      )}
      {props.activeFrame === undefined ? null : (
        <ExitChip
          controller={controller}
          model={props.activeFrame}
          onExit={props.onDeactivate}
        />
      )}
      <PinsLayer
        controller={controller}
        viewport={props.viewport}
        pins={props.pins}
        rects={props.rects}
        adapters={props.adapters}
        settled={camera.settled.camera}
        tick={props.tick}
        selectedId={props.selectedThreadId}
        onSelect={props.onSelectThread}
      />
      <ToolPill groups={props.toolGroups} />
      <ZoomPill
        controller={controller}
        hasSelection={selection.size > 0}
        onZoom={camera.zoomBy}
        onReset={camera.reset}
        onFitAll={camera.fitAll}
        onFitSelection={camera.fitSelection}
      />
    </div>
  );
}
