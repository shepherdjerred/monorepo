import { noop } from "#client/lib/noop.ts";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { FileViewer } from "./file-viewer.tsx";
import { FrameViewer } from "./frame-viewer.tsx";
import { ImageViewer } from "./image-viewer.tsx";
import { MarkdownViewer } from "./markdown-viewer.tsx";
import { PinsOverlay } from "./pins-overlay.tsx";
import {
  type AnchorAdapter,
  type PresetId,
  type ReviewState,
  type ViewerArtifact,
  type ViewerMode,
} from "./types.ts";
import { VideoViewer } from "./video-viewer.tsx";

// pdf.js and the terminal player are the two big dependencies; load them when
// a board or a focused view actually shows one.
async function loadPdfViewer() {
  const module = await import("./pdf-viewer.tsx");
  return { default: module.PdfViewer };
}
async function loadCastViewer() {
  const module = await import("./cast-viewer.tsx");
  return { default: module.CastViewer };
}
const PdfViewer = lazy(loadPdfViewer);
const CastViewer = lazy(loadCastViewer);
import type { VersionView } from "@shepherdjerred/artifacts/procedures";

export type ArtifactViewerProps = {
  readonly artifact: ViewerArtifact;
  readonly version: VersionView;
  readonly mode: ViewerMode;
  readonly active?: boolean;
  readonly onActiveChange?: (active: boolean) => void;
  readonly review?: ReviewState | null;
  readonly preset?: PresetId;
  /** Receives the stage's adapter so a page can reveal a thread's anchor. */
  readonly adapterRef?: { current: AnchorAdapter | null };
};

/**
 * The one viewer switch. Every kind renders inside the same stage: the stage
 * owns the pins overlay and, in comment mode, turns a click into an anchor
 * through the viewer's `AnchorAdapter`.
 */
export function ArtifactViewer({
  artifact,
  version,
  mode,
  active = false,
  onActiveChange,
  review = null,
  preset = "desktop",
  adapterRef,
}: ArtifactViewerProps): React.JSX.Element {
  const ownAdapter = useRef<AnchorAdapter | null>(null);
  const adapter = adapterRef ?? ownAdapter;
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [tick, setTick] = useState(0);
  const onViewChange = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  const props = {
    artifact,
    version,
    mode,
    active,
    onActiveChange: onActiveChange ?? noop,
    review,
    adapterRef: adapter,
    onViewChange,
    preset,
  };

  const commenting = review?.commentMode === true;

  function place(event: React.MouseEvent): void {
    if (review?.commentMode !== true) return;
    if (
      event.target instanceof Element &&
      event.target.closest(".ar-pin") !== null
    )
      return;
    const point = { x: event.clientX, y: event.clientY };
    const current = adapter.current;
    const anchor = current?.toAnchor(point) ?? null;
    if (current === null || anchor === null) return;
    event.preventDefault();
    event.stopPropagation();
    const { onPlace } = review;
    void (current.probe?.(point) ?? Promise.resolve(anchor)).then((refined) => {
      onPlace(refined ?? anchor, point);
    });
  }

  return (
    <div
      className="ar-stage"
      ref={setStage}
      data-kind={artifact.kind}
      data-mode={mode}
      data-commenting={commenting}
      onClickCapture={place}
    >
      <Suspense
        fallback={
          <p className="ar-note" role="status">
            Loading viewer…
          </p>
        }
      >
        <Viewer {...props} />
      </Suspense>
      {review === null ? null : (
        <PinsOverlay
          pins={review.pins}
          adapterRef={adapter}
          stage={stage}
          tick={tick}
          selectedId={review.selectedId}
          onSelect={review.onSelect}
        />
      )}
    </div>
  );
}

function Viewer(props: Parameters<typeof FrameViewer>[0]): React.JSX.Element {
  switch (props.artifact.kind) {
    case "html":
    case "site":
    case "mermaid":
      return <FrameViewer {...props} />;
    case "pdf":
      return <PdfViewer {...props} />;
    case "image":
      return <ImageViewer {...props} />;
    case "video":
      return <VideoViewer {...props} />;
    case "markdown":
      return <MarkdownViewer {...props} />;
    case "cast":
      return <CastViewer {...props} />;
    case "file":
      return <FileViewer {...props} />;
  }
}
