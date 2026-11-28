import "#client/styles/text-layer.css";
import { useEffect, useRef, useState } from "react";
import {
  normalizeRotation,
  pdfRenderScale,
  type Rotation,
} from "#client/lib/geometry.ts";
import {
  loadPdfjs,
  type PdfDocument,
  type PdfPageProxy,
} from "./pdf-runtime.ts";

export type PageSize = {
  /** The page's width and height at scale 1, as drawn (rotation applied). */
  readonly width: number;
  readonly height: number;
  readonly rotation: Rotation;
};

/** One page: a canvas at device resolution and, in focus mode, a text layer. */
export function PdfPage({
  doc,
  pageNumber,
  displayWidth,
  size,
  textLayer,
  onSize,
  onRendered,
}: {
  readonly doc: PdfDocument;
  readonly pageNumber: number;
  readonly displayWidth: number;
  readonly size: PageSize | undefined;
  readonly textLayer: boolean;
  readonly onSize: (pageNumber: number, size: PageSize) => void;
  readonly onRendered: () => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PdfPageProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const loaded = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = loaded.getViewport({ scale: 1 });
      onSize(pageNumber, {
        width: viewport.width,
        height: viewport.height,
        rotation: normalizeRotation(loaded.rotate),
      });
      setPage(loaded);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, onSize]);

  const cssScale = size === undefined ? 1 : displayWidth / size.width;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (page === null || canvas === null || size === undefined) return;
    const scale = pdfRenderScale({
      pageWidth: size.width,
      pageHeight: size.height,
      cssScale,
      dpr: window.devicePixelRatio,
    });
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = page.render({ canvas, viewport });
    let cancelled = false;
    async function finish(): Promise<void> {
      try {
        await task.promise;
        if (!cancelled) onRendered();
      } catch (error: unknown) {
        // A cancelled render rejects by design.
        if (!(
          error instanceof Error && error.name === "RenderingCancelledException"
        ))
          console.warn("PDF page failed to render", error);
      }
    }
    void finish();
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [page, size, cssScale, onRendered]);

  useEffect(() => {
    const container = textRef.current;
    if (!textLayer || page === null || container === null || size === undefined)
      return;
    container.style.setProperty("--total-scale-factor", String(cssScale));
    const current = page;
    const target = container;
    let cancelled = false;
    let layer: { cancel: () => void } | undefined;
    async function draw(): Promise<void> {
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      target.replaceChildren();
      const next = new pdfjs.TextLayer({
        textContentSource: current.streamTextContent(),
        container: target,
        viewport: current.getViewport({ scale: cssScale }),
      });
      layer = next;
      try {
        await next.render();
      } catch {
        // A cancelled text layer rejects by design.
        return;
      }
    }
    void draw();
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [page, textLayer, cssScale, size]);

  const height =
    size === undefined
      ? displayWidth * 1.3
      : (displayWidth * size.height) / size.width;

  return (
    <div
      className="ar-pdf-page"
      data-page={pageNumber}
      data-testid="pdf-page"
      style={{ width: displayWidth, height }}
    >
      <canvas
        ref={canvasRef}
        aria-label={`Page ${String(pageNumber)}`}
        role="img"
      />
      {textLayer ? <div ref={textRef} className="textLayer" /> : null}
    </div>
  );
}
