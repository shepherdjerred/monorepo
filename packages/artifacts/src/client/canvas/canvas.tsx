import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Anchor } from "@shepherdjerred/artifacts/contract";
import type { BoardData } from "#client/data/api.ts";
import { useCreateThread } from "#client/data/mutations.ts";
import type { Point } from "#client/lib/geometry.ts";
import {
  PlacementComposer,
  type Placement,
} from "#client/pages/placement-composer.tsx";
import { clickSelection } from "./arrange/geometry.ts";
import { MarqueeBox, ResizeHandles } from "./arrange/handles.tsx";
import { RemoveDialog } from "./arrange/remove-dialog.tsx";
import { Toasts, useNewFrameToasts } from "./arrange/toasts.tsx";
import { useArrange } from "./arrange/use-arrange.ts";
import { useArrangeKeys } from "./arrange/use-keys.ts";
import { useArrangeSessions } from "./arrange/use-sessions.ts";
import { screenToWorld, type WorldRect } from "./camera.ts";
import { CanvasFrame } from "./canvas-frame.tsx";
import type { Tap } from "./gestures.ts";
import { readingOrder, type CanvasPin } from "./model.ts";
import { ExitChip, FrameChip, SelectionRing } from "./overlay.tsx";
import { PinsLayer } from "./pins-layer.tsx";
import { commentTool, pointerTools, ToolPill, ZoomPill } from "./toolbar.tsx";
import { useCanvasCamera } from "./use-camera.ts";
import { useCanvasKeys } from "./use-canvas-keys.ts";
import { useCanvasInput } from "./use-input.ts";
import { useFrameTiers } from "./use-tiers.ts";
import { useToolModes } from "./use-tools.ts";

/** Rounds a placed pin to a tenth of a pixel so the stored anchor is tidy. */
function tidy(value: number): number {
  return Math.round(value * 10) / 10;
}

type CanvasPlacement = Placement & { readonly frameId: string | null };

export type CanvasProps = {
  readonly slug: string;
  readonly data: Pick<BoardData, "index" | "artifacts">;
  readonly pins: readonly CanvasPin[];
  readonly selectedThreadId: string | null;
  readonly onSelectThread: (threadId: string | null) => void;
  /** Pixels on the right that the open comments panel covers. */
  readonly rightInset: number;
};

const SAVE_TEXT = {
  saving: "Saving…",
  error: "Could not save; retrying",
} as const;

export function Canvas({
  slug,
  data,
  pins,
  selectedThreadId,
  onSelectThread,
  rightInset,
}: CanvasProps): React.JSX.Element {
  const create = useCreateThread();
  const arrange = useArrange(slug, data);
  const { frames, selection, setSelection } = arrange;

  const byId = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame])),
    [frames],
  );
  const rects = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame.rect])),
    [frames],
  );
  const inReadingOrder = useMemo(() => readingOrder(frames), [frames]);
  const selectedFrames = useMemo(
    () => frames.filter((frame) => selection.has(frame.id)),
    [frames, selection],
  );
  const only = selectedFrames.length === 1 ? selectedFrames[0] : undefined;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<CanvasPlacement | null>(null);
  const dropPlacement = useCallback(() => {
    setPlacement(null);
  }, []);
  const dropLive = useCallback(() => {
    setActiveId(null);
  }, []);
  const {
    tool,
    commentMode,
    selectTool,
    handTool,
    toggleHand,
    toggleComment,
    leaveComment,
  } = useToolModes({ placement: dropPlacement, live: dropLive });
  const [marquee, setMarquee] = useState<WorldRect | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [tick, setTick] = useState(0);
  const [blanket, setBlanket] = useState<HTMLDivElement | null>(null);
  const [section, setSection] = useState<HTMLElement | null>(null);

  const activeFrame = activeId === null ? undefined : byId.get(activeId);
  const camera = useCanvasCamera(slug, frames, selectedFrames, rightInset);
  const { controller, viewport, reveal, sizeRef } = camera;
  const tiers = useFrameTiers({
    frames,
    settled: camera.settled,
    size: camera.size,
    cap: camera.cap,
    activeId,
  });

  const leaveCommentRef = useRef(leaveComment);
  leaveCommentRef.current = leaveComment;
  const latest = useRef({ commentMode, activeId, byId });
  latest.current = { commentMode, activeId, byId };

  const activate = useCallback(
    (id: string) => {
      const frame = latest.current.byId.get(id);
      if (frame === undefined || frame.summary.kind === "file") return;
      setSelection(new Set([id]));
      setActiveId(id);
      leaveCommentRef.current();
      setPlacement(null);
      reveal(frame.rect);
      // The same iframe element gains focus; nothing remounts.
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-frame-id="${id}"]`)
          ?.querySelector<HTMLElement>(
            "iframe, video, audio, [tabindex], button, a[href]",
          )
          ?.focus();
      });
    },
    [reveal, setSelection],
  );

  const deactivate = useCallback(() => {
    setActiveId((current) => {
      if (current !== null)
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(
              `[data-frame-chip="${current}"] .ar-cv-chip-main`,
            )
            ?.focus();
        });
      return null;
    });
  }, []);

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const onTap = useCallback(
    (tap: Tap) => {
      if (!latest.current.commentMode) {
        if (tap.frameId === null) {
          if (!tap.shiftKey) setSelection(new Set());
        } else
          setSelection(
            clickSelection(selectionRef.current, tap.frameId, tap.shiftKey),
          );
        return;
      }
      // On a frame, the frame's own stage places the pin; empty canvas places a board pin.
      const box = viewport?.getBoundingClientRect();
      if (box === undefined || tap.frameId !== null) return;
      const world = screenToWorld(controller.get(), tap.point);
      const [x, y] = [tidy(world.x), tidy(world.y)];
      setPlacement({
        // The board origin is how a plain board comment is stored, so a pin never sits there.
        anchor: { type: "board", page: 0, x, y: x === 0 && y === 0 ? 0.1 : y },
        at: { x: box.left + tap.point.x, y: box.top + tap.point.y },
        frameId: null,
      });
    },
    [controller, viewport, setSelection],
  );

  const onDoubleTap = useCallback(
    (id: string) => {
      // In comment mode a double click is two comments' worth of clicking.
      if (!latest.current.commentMode) activate(id);
    },
    [activate],
  );
  const viewportSize = useCallback(() => sizeRef.current, [sizeRef]);
  const sessions = useArrangeSessions({
    controller,
    size: viewportSize,
    arrange,
    frames,
    blocked: (frameId) =>
      latest.current.commentMode ||
      (frameId !== null && frameId === latest.current.activeId),
    setMarquee,
  });
  const onHostInput = useCanvasInput({
    controller,
    viewport,
    blanket,
    tool,
    onTap,
    onDoubleTap,
    beginSession: sessions.beginSession,
  });

  const onPlace = useCallback((frameId: string, anchor: Anchor, at: Point) => {
    setPlacement({ anchor, at, frameId });
  }, []);
  const onViewChange = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  function submitPlacement(body: string): void {
    if (placement === null) return;
    const frame =
      placement.frameId === null ? undefined : byId.get(placement.frameId);
    const version = frame?.summary.currentVersion ?? null;
    create.mutate(
      {
        board: slug,
        ...(frame === undefined ? {} : { artifactId: frame.id }),
        ...(version === null ? {} : { versionId: version.id }),
        anchor: placement.anchor,
        body,
      },
      {
        onSuccess: (thread) => {
          setPlacement(null);
          leaveComment();
          onSelectThread(thread.id);
        },
      },
    );
  }

  // Selecting a thread elsewhere (the sidebar) brings its pin into view, once
  // per selection: a refetch of the pins must not move the camera.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (selectedThreadId === null || selectedThreadId === revealed.current)
      return;
    const pin = pins.find((candidate) => candidate.id === selectedThreadId);
    if (pin === undefined) return;
    revealed.current = selectedThreadId;
    const frame = pin.frameId === null ? undefined : byId.get(pin.frameId);
    if (frame !== undefined) reveal(frame.rect);
    else if (pin.anchor.type === "board")
      reveal({ x: pin.anchor.x - 40, y: pin.anchor.y - 40, w: 80, h: 80 });
  }, [selectedThreadId, pins, byId, reveal]);

  const toasts = useNewFrameToasts(frames, arrange.takeOwn);
  const jumpTo = useCallback(
    (id: string) => {
      const frame = latest.current.byId.get(id);
      if (frame === undefined) return;
      setSelection(new Set([id]));
      reveal(frame.rect);
    },
    [reveal, setSelection],
  );

  useArrangeKeys({
    arrange,
    onDelete: () => {
      if (activeId === null && selection.size > 0) setConfirmRemove(true);
    },
  });
  const toolGroups = pointerTools({
    tool,
    commenting: commentMode,
    onSelect: selectTool,
    onHand: handTool,
  });

  useCanvasKeys({
    camera,
    onlyId: only?.id ?? null,
    placing: placement !== null,
    activeId,
    commentMode,
    tool,
    selectTool,
    toggleHand,
    toggleComment,
    activate,
    cancelPlacement: () => {
      setPlacement(null);
    },
    deactivate,
    leaveComment,
    clearSelection: () => {
      setSelection(new Set());
    },
  });

  const removing = selectedFrames.map((frame) => frame.summary.title);

  return (
    <section
      className="ar-cv"
      ref={setSection}
      aria-label="Board canvas"
      data-tool={tool}
      data-commenting={commentMode}
      data-live={activeId !== null}
    >
      <div
        className="ar-cv-viewport"
        ref={camera.setViewport}
        data-testid="canvas-viewport"
        data-pan="false"
      >
        <div className="ar-cv-overlay" data-testid="canvas-overlay">
          <div
            className="ar-cv-chips"
            role="group"
            aria-label="Frames in reading order"
          >
            {inReadingOrder.map((frame) => (
              <FrameChip
                key={frame.id}
                controller={controller}
                model={frame}
                selected={selection.has(frame.id)}
                active={frame.id === activeId}
                onSelect={(id) => {
                  setSelection(new Set([id]));
                }}
                onActivate={activate}
                onFocusFrame={(id) => {
                  const target = byId.get(id);
                  if (target !== undefined) reveal(target.rect);
                }}
              />
            ))}
          </div>
          {selectedFrames.map((frame) => (
            <SelectionRing
              key={frame.id}
              controller={controller}
              model={frame}
              active={frame.id === activeId}
            />
          ))}
          {commentMode || only === undefined || only.id === activeId ? null : (
            <ResizeHandles
              key={only.id}
              controller={controller}
              rect={only.rect}
              start={(handle, point) =>
                sessions.startResize(only.id, handle, point)
              }
            />
          )}
          {marquee === null ? null : (
            <MarqueeBox controller={controller} rect={marquee} />
          )}
          {activeFrame === undefined ? null : (
            <ExitChip
              controller={controller}
              model={activeFrame}
              onExit={deactivate}
            />
          )}
          <PinsLayer
            controller={controller}
            viewport={viewport}
            pins={pins}
            rects={rects}
            adapters={tiers.adapters}
            settled={camera.settled.camera}
            tick={tick}
            selectedId={selectedThreadId}
            onSelect={onSelectThread}
          />
          <ToolPill
            groups={[
              toolGroups.pointer,
              [
                commentTool({
                  commenting: commentMode,
                  onToggle: toggleComment,
                }),
              ],
            ]}
          />
          <ZoomPill
            controller={controller}
            hasSelection={selection.size > 0}
            onZoom={camera.zoomBy}
            onReset={camera.reset}
            onFitAll={camera.fitAll}
            onFitSelection={camera.fitSelection}
          />
        </div>
        <div
          className="ar-cv-world"
          ref={camera.setWorld}
          data-testid="canvas-world"
        >
          {frames.map((frame) => (
            <CanvasFrame
              key={frame.id}
              model={frame}
              detail={tiers.detailById.get(frame.id)}
              tier={tiers.tierOf(frame.id)}
              active={frame.id === activeId}
              commenting={commentMode}
              adapterRef={tiers.adapterFor(frame.id)}
              onRequestLoad={tiers.requestLoad}
              onPlace={onPlace}
              onHostInput={onHostInput}
              onViewChange={onViewChange}
            />
          ))}
        </div>
        <div className="ar-cv-blanket" ref={setBlanket} hidden />
      </div>
      {frames.length === 0 ? (
        <p className="ar-cv-empty">Nothing on this board yet.</p>
      ) : null}
      {arrange.status === "idle" ? null : (
        <p
          className="ar-cv-save"
          role="status"
          data-status={arrange.status}
          data-testid="save-status"
        >
          {SAVE_TEXT[arrange.status]}
        </p>
      )}
      <Toasts
        toasts={toasts.toasts}
        onJump={jumpTo}
        onDismiss={toasts.dismiss}
      />
      <p className="ui-sr-only" role="status" aria-live="polite">
        {arrange.announcement}
      </p>
      {placement === null ? null : (
        <PlacementComposer
          placement={placement}
          pane={section}
          pending={create.isPending}
          onSubmit={submitPlacement}
          onCancel={() => {
            setPlacement(null);
          }}
        />
      )}
      {commentMode && placement === null ? (
        <p className="ar-mode-hint" role="status">
          Comment mode: click where the comment belongs. Esc to leave.
        </p>
      ) : null}
      <RemoveDialog
        titles={removing}
        open={confirmRemove}
        onClose={() => {
          setConfirmRemove(false);
        }}
        onConfirm={() => {
          arrange.remove();
          setConfirmRemove(false);
        }}
      />
    </section>
  );
}
