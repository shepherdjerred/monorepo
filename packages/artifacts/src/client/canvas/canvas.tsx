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
import { RemoveDialog } from "./arrange/remove-dialog.tsx";
import { Toasts, useNewFrameToasts } from "./arrange/toasts.tsx";
import { useArrange } from "./arrange/use-arrange.ts";
import { useArrangeKeys } from "./arrange/use-keys.ts";
import { useArrangeSessions } from "./arrange/use-sessions.ts";
import { screenToWorld, type WorldRect } from "./camera.ts";
import { CanvasFrame } from "./canvas-frame.tsx";
import type { Tap } from "./gestures.ts";
import { readingOrder, type CanvasPin } from "./model.ts";
import { commentTool, drawingTools, pointerTools } from "./toolbar.tsx";
import { CanvasOverlay } from "./canvas-overlay.tsx";
import { NoteWorld } from "./notes/note-parts.tsx";
import { isDrawTool } from "./gestures.ts";
import { useNotes } from "./notes/use-notes.ts";
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
    pickTool,
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
  const latest = useRef({ commentMode, activeId, byId, tool });
  latest.current = { commentMode, activeId, byId, tool };

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

  const notes = useNotes({
    arrange,
    controller,
    frames: byId,
    tool,
    selectTool,
  });
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const onTap = useCallback(
    (tap: Tap) => {
      if (isDrawTool(latest.current.tool)) {
        // A click with the text or sticky tool makes one; other tools need a drag.
        notes.createAt(tap.point);
        return;
      }
      if (!latest.current.commentMode) {
        if (tap.targetId === null) {
          if (!tap.shiftKey) setSelection(new Set());
        } else
          setSelection(
            clickSelection(selectionRef.current, tap.targetId, tap.shiftKey),
          );
        return;
      }
      // On a frame, the frame's own stage places the pin; empty canvas places a board pin.
      const box = viewport?.getBoundingClientRect();
      if (box === undefined || tap.targetId !== null) return;
      const world = screenToWorld(controller.get(), tap.point);
      const [x, y] = [tidy(world.x), tidy(world.y)];
      setPlacement({
        // The board origin is how a plain board comment is stored, so a pin never sits there.
        anchor: { type: "board", page: 0, x, y: x === 0 && y === 0 ? 0.1 : y },
        at: { x: box.left + tap.point.x, y: box.top + tap.point.y },
        frameId: null,
      });
    },
    [controller, viewport, setSelection, notes],
  );

  const onDoubleTap = useCallback(
    (id: string) => {
      // In comment mode a double click is two comments' worth of clicking.
      if (latest.current.commentMode) return;
      if (arrange.notes.some((model) => model.id === id)) notes.startEdit(id);
      else activate(id);
    },
    [activate, arrange.notes, notes],
  );
  const viewportSize = useCallback(() => sizeRef.current, [sizeRef]);
  const sessions = useArrangeSessions({
    controller,
    size: viewportSize,
    arrange,
    frames,
    notes: arrange.notes,
    tool,
    color: notes.color,
    blocked: (targetId) =>
      latest.current.commentMode ||
      (targetId !== null && targetId === latest.current.activeId),
    shift: notes.shiftHeld,
    setMarquee,
    setPreview: notes.setPreview,
    onCreate: notes.onCreate,
  });
  const onHostInput = useCanvasInput({
    controller,
    viewport,
    blanket,
    tool,
    onTap,
    onDoubleTap,
    pick: notes.pick,
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
      if (activeId !== null || selection.size === 0) return;
      // Frames ask first; annotations alone are deleted at once (and undo brings them back).
      if (selectedFrames.length > 0) setConfirmRemove(true);
      else arrange.remove();
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
    pickTool,
    onEnter: () => {
      if (only !== undefined) activate(only.id);
      else if (notes.onlyNote !== undefined) notes.startEdit(notes.onlyNote.id);
    },
    toggleHand,
    toggleComment,
    cancelPlacement: () => {
      setPlacement(null);
    },
    deactivate,
    leaveComment,
    clearSelection: () => {
      setSelection(new Set());
    },
  });

  const onlyNote = selection.size === 1 ? notes.onlyNote : undefined;
  const resizable =
    only ??
    (onlyNote?.note.type === "box" || onlyNote?.note.type === "sticky"
      ? onlyNote
      : undefined);

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
        <CanvasOverlay
          controller={controller}
          camera={camera}
          viewport={viewport}
          tiers={tiers}
          sessions={sessions}
          notes={notes}
          inReadingOrder={inReadingOrder}
          byId={byId}
          selection={selection}
          selectedFrames={selectedFrames}
          selectedNotes={notes.selectedNotes}
          resizable={resizable}
          activeId={activeId}
          activeFrame={activeFrame}
          commentMode={commentMode}
          marquee={marquee}
          toolGroups={[
            toolGroups.pointer,
            drawingTools({ tool, commenting: commentMode, onPick: pickTool }),
            [commentTool({ commenting: commentMode, onToggle: toggleComment })],
          ]}
          pins={pins}
          rects={rects}
          adapters={tiers.adapters}
          tick={tick}
          selectedThreadId={selectedThreadId}
          onSelectThread={onSelectThread}
          onSelectFrame={(id) => {
            setSelection(new Set([id]));
          }}
          onActivate={activate}
          onDeactivate={deactivate}
        />
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
          <NoteWorld
            notes={arrange.notes}
            preview={notes.preview}
            editing={notes.editing}
          />
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
