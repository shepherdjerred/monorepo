import { useVirtualizer } from "@tanstack/react-virtual";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  contains,
  normalizeRotation,
  pageAnchor,
  pageAnchorToClient,
} from "#client/lib/geometry.ts";
import { openPdf, type PdfDocument } from "./pdf-runtime.ts";
import { PdfPage, type PageSize } from "./pdf-page.tsx";
import {
  contentFileUrl,
  type AnchorAdapter,
  type ViewerProps,
} from "./types.ts";

const PAGE_GAP = 12;
const SIDE_PADDING = 16;
const MAX_FIT_WIDTH = 1000;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

function usePdf(url: string | null) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; doc: PdfDocument }
    | { status: "error"; message: string }
  >({ status: "loading" });
  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    let opened: PdfDocument | undefined;
    async function open(target: string): Promise<void> {
      try {
        const doc = await openPdf(target, controller.signal);
        opened = doc;
        if (controller.signal.aborted) await doc.loadingTask.destroy();
        else setState({ status: "ready", doc });
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : "Could not open the PDF",
          });
      }
    }
    void open(url);
    return () => {
      controller.abort();
      void opened?.loadingTask.destroy();
    };
  }, [url]);
  return state;
}

export function PdfViewer({
  version,
  mode,
  adapterRef,
  onViewChange,
}: ViewerProps): React.JSX.Element {
  const url = contentFileUrl(version, version.entryPath);
  const state = usePdf(url);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [sizes, setSizes] = useState<ReadonlyMap<number, PageSize>>(new Map());
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [state.status]);

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  const fit = Math.max(
    120,
    Math.min(
      width - SIDE_PADDING * 2,
      mode === "focus" ? MAX_FIT_WIDTH : width,
    ),
  );
  const displayWidth = Math.round(fit * (mode === "focus" ? zoom : 1));
  const count = state.status === "ready" ? state.doc.numPages : 0;

  const onSize = useCallback((pageNumber: number, size: PageSize) => {
    setSizes((current) => {
      const known = current.get(pageNumber);
      return known?.width === size.width && known.height === size.height
        ? current
        : new Map(current).set(pageNumber, size);
    });
  }, []);

  const estimate = (index: number): number => {
    const size = sizes.get(index + 1) ?? sizes.get(1);
    return (
      (size === undefined
        ? displayWidth * 1.3
        : (displayWidth * size.height) / size.width) + PAGE_GAP
    );
  };

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimate,
    overscan: 1,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [displayWidth, sizes, virtualizer]);

  const adapter = useMemo<AnchorAdapter>(() => {
    function pages(): { element: HTMLElement; number: number }[] {
      const root = scrollRef.current;
      if (root === null) return [];
      return [...root.querySelectorAll<HTMLElement>("[data-page]")].map(
        (element) => ({
          element,
          number: Number(element.dataset["page"]),
        }),
      );
    }
    return {
      toAnchor(point) {
        for (const { element, number } of pages()) {
          const rect = element.getBoundingClientRect();
          if (!contains(rect, point)) continue;
          const rotation = normalizeRotation(
            sizesRef.current.get(number)?.rotation ?? 0,
          );
          return pageAnchor(number, rect, rotation, point);
        }
        return null;
      },
      toClient(anchor) {
        if (anchor.type !== "page") return null;
        const found = pages().find(
          (candidate) => candidate.number === anchor.page,
        );
        if (found === undefined) return null;
        const rotation = normalizeRotation(
          sizesRef.current.get(anchor.page)?.rotation ?? 0,
        );
        return pageAnchorToClient(
          anchor,
          found.element.getBoundingClientRect(),
          rotation,
        );
      },
      reveal(anchor) {
        if (anchor.type !== "page") return;
        virtualizer.scrollToIndex(anchor.page - 1, { align: "start" });
        requestAnimationFrame(() => {
          const size = sizesRef.current.get(anchor.page);
          const scroller = scrollRef.current;
          if (size === undefined || scroller === null) return;
          const pageHeight = (displayWidth * size.height) / size.width;
          scroller.scrollBy({ top: Math.max(0, anchor.y * pageHeight - 140) });
        });
      },
    };
  }, [virtualizer, displayWidth]);

  useEffect(() => {
    adapterRef.current = adapter;
    onViewChange();
    return () => {
      adapterRef.current = null;
    };
  }, [adapter, adapterRef, onViewChange]);

  if (url === null)
    return <p className="ar-note">This version’s files were deleted.</p>;
  if (state.status === "error")
    return (
      <p className="ar-note" role="alert">
        {state.message}
      </p>
    );
  if (state.status === "loading")
    return (
      <p className="ar-note" role="status">
        Opening PDF…
      </p>
    );

  const items = virtualizer.getVirtualItems();
  // The page across the middle of the pane, not the first one overscanned.
  const middle =
    (virtualizer.scrollOffset ?? 0) +
    (scrollRef.current?.clientHeight ?? 0) / 2;
  const firstVisible =
    (items.find((item) => item.end > middle) ?? items[0])?.index ?? 0;

  return (
    <div className="ar-pdf" data-mode={mode}>
      {mode === "focus" ? (
        <div className="ar-pdf-bar" role="toolbar" aria-label="PDF">
          <span aria-live="polite">
            Page {firstVisible + 1} of {count}
          </span>
          <span className="ar-grow" />
          <button
            type="button"
            className="ui-btn"
            aria-label="Zoom out"
            disabled={zoomIndex === 0}
            onClick={() => {
              setZoomIndex((value) => Math.max(0, value - 1));
            }}
          >
            <MinusIcon aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              setZoomIndex(2);
            }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="ui-btn"
            aria-label="Zoom in"
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            onClick={() => {
              setZoomIndex((value) =>
                Math.min(ZOOM_STEPS.length - 1, value + 1),
              );
            }}
          >
            <PlusIcon aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div
        className="ar-pdf-scroll"
        ref={scrollRef}
        data-testid="pdf-scroll"
        tabIndex={0}
        role="region"
        aria-label="PDF pages"
        onScroll={onViewChange}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {items.map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="ar-pdf-slot"
              style={{ transform: `translateY(${String(item.start)}px)` }}
            >
              <PdfPage
                doc={state.doc}
                pageNumber={item.index + 1}
                displayWidth={displayWidth}
                size={sizes.get(item.index + 1)}
                textLayer={mode === "focus"}
                onSize={onSize}
                onRendered={onViewChange}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
