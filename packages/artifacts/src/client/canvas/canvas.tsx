import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { Anchor } from "@shepherdjerred/artifacts/contract";
import { useCreateThread } from "#client/data/mutations.ts";
import type { Point } from "#client/lib/geometry.ts";
import {
  PlacementComposer,
  type Placement,
} from "#client/pages/placement-composer.tsx";
import { useShortcuts } from "#client/shell/shortcuts.ts";
import { screenToWorld } from "./camera.ts";
import { CanvasFrame } from "./canvas-frame.tsx";
import type { Tap, Tool } from "./gestures.ts";
import {
  readingOrder,
  type CanvasFrameModel,
  type CanvasPin,
} from "./model.ts";
import { ExitChip, FrameChip, SelectionRing } from "./overlay.tsx";
import { PinsLayer } from "./pins-layer.tsx";
import { CanvasToolbar } from "./toolbar.tsx";
import { useCanvasCamera, ZOOM_STEP } from "./use-camera.ts";
import { useCanvasInput } from "./use-input.ts";
import { useFrameTiers } from "./use-tiers.ts";

/** Rounds a placed pin to a tenth of a pixel so the stored anchor is tidy. */
function tidy(value: number): number {
  return Math.round(value * 10) / 10;
}

type CanvasPlacement = Placement & { readonly frameId: string | null };

export type CanvasProps = {
  readonly slug: string;
  readonly frames: readonly CanvasFrameModel[];
  readonly pins: readonly CanvasPin[];
  readonly selectedThreadId: string | null;
  readonly onSelectThread: (threadId: string | null) => void;
};

export function Canvas({
  slug,
  frames,
  pins,
  selectedThreadId,
  onSelectThread,
}: CanvasProps): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateThread();

  const byId = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame])),
    [frames],
  );
  const rects = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame.rect])),
    [frames],
  );
  const inReadingOrder = useMemo(() => readingOrder(frames), [frames]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [commentMode, setCommentMode] = useState(false);
  const [placement, setPlacement] = useState<CanvasPlacement | null>(null);
  const [tick, setTick] = useState(0);
  const [blanket, setBlanket] = useState<HTMLDivElement | null>(null);
  const [section, setSection] = useState<HTMLElement | null>(null);

  const selectedFrame = selectedId === null ? undefined : byId.get(selectedId);
  const activeFrame = activeId === null ? undefined : byId.get(activeId);
  const camera = useCanvasCamera(slug, frames, selectedFrame);
  const { controller, viewport, reveal } = camera;
  const tiers = useFrameTiers({
    frames,
    settled: camera.settled,
    size: camera.size,
    cap: camera.cap,
    activeId,
  });

  const latest = useRef({ commentMode, byId });
  latest.current = { commentMode, byId };

  const activate = useCallback(
    (id: string) => {
      const frame = latest.current.byId.get(id);
      if (frame === undefined || frame.summary.kind === "file") return;
      setSelectedId(id);
      setActiveId(id);
      setCommentMode(false);
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
    [reveal],
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

  const onTap = useCallback(
    (tap: Tap) => {
      if (!latest.current.commentMode) {
        setSelectedId(tap.frameId);
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
    [controller, viewport],
  );

  const onDoubleTap = useCallback(
    (id: string) => {
      // In comment mode a double click is two comments' worth of clicking.
      if (!latest.current.commentMode) activate(id);
    },
    [activate],
  );
  const onHostInput = useCanvasInput({
    controller,
    viewport,
    blanket,
    tool,
    onTap,
    onDoubleTap,
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
          setCommentMode(false);
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

  useShortcuts([
    { key: "1", run: camera.fitAll },
    { key: "2", run: camera.fitSelection },
    { key: "0", run: camera.reset },
    {
      key: "=",
      run: () => {
        camera.zoomBy(ZOOM_STEP);
      },
    },
    {
      key: "+",
      run: () => {
        camera.zoomBy(ZOOM_STEP);
      },
    },
    {
      key: "-",
      run: () => {
        camera.zoomBy(1 / ZOOM_STEP);
      },
    },
    {
      key: "h",
      run: () => {
        setTool((current) => (current === "hand" ? "select" : "hand"));
      },
    },
    {
      key: "c",
      run: () => {
        setCommentMode((on) => !on);
        setActiveId(null);
        setPlacement(null);
      },
    },
    {
      key: "f",
      run: () => {
        if (selectedId !== null) void navigate(`/a/${selectedId}`);
      },
    },
    {
      key: "Enter",
      run: (event) => {
        if (selectedId === null) return;
        event.preventDefault();
        activate(selectedId);
      },
    },
    {
      key: "Escape",
      run: () => {
        if (placement !== null) setPlacement(null);
        else if (activeId !== null) deactivate();
        else if (commentMode) setCommentMode(false);
        else if (tool === "hand") setTool("select");
        else setSelectedId(null);
      },
    },
  ]);

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
                selected={frame.id === selectedId}
                active={frame.id === activeId}
                onSelect={setSelectedId}
                onActivate={activate}
                onFocusFrame={(id) => {
                  const target = byId.get(id);
                  if (target !== undefined) reveal(target.rect);
                }}
              />
            ))}
          </div>
          {selectedFrame === undefined ? null : (
            <SelectionRing
              controller={controller}
              model={selectedFrame}
              active={selectedFrame.id === activeId}
            />
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
          <CanvasToolbar
            controller={controller}
            tool={tool}
            commenting={commentMode}
            hasSelection={selectedId !== null}
            onZoom={camera.zoomBy}
            onReset={camera.reset}
            onFitAll={camera.fitAll}
            onFitSelection={camera.fitSelection}
            onTool={setTool}
            onComment={(on) => {
              setCommentMode(on);
              setPlacement(null);
              if (on) setActiveId(null);
            }}
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
    </section>
  );
}
