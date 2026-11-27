import { LogOutIcon, PointerIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clientToFramePixels,
  docAnchorFromFramePixels,
  frameAnchor,
  framePixelsFromDocAnchor,
  framePixelsToClient,
  contains,
  denormalizeInRect,
  type DocState,
  type Point,
} from "#client/lib/geometry.ts";
import { nextDocState } from "./doc-state.ts";
import {
  createBridgeHost,
  docAnchorFromPoint,
  type BridgeHost,
  type FrameMessage,
  type FrameMode,
} from "./bridge-protocol.ts";
import {
  contentFileUrl,
  type AnchorAdapter,
  type PresetId,
  type ViewerProps,
} from "./types.ts";
import { useAdapterRegistration } from "./use-adapter-registration.ts";

export const PRESET_SIZES: Readonly<
  Record<Exclude<PresetId, "responsive">, { width: number; height: number }>
> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

/** The sandbox every frame carries. `allow-same-origin` is never one of them. */
export const FRAME_SANDBOX = "allow-scripts allow-forms allow-popups";

const PROBE_TIMEOUT_MS = 300;

export function presetSize(
  preset: PresetId,
  published: { width: number; height: number } | null,
  container: { width: number; height: number },
): { width: number; height: number } {
  if (preset === "responsive") {
    return {
      width: Math.max(1, Math.round(container.width)),
      height: Math.max(1, Math.round(container.height)),
    };
  }
  const base = PRESET_SIZES[preset];
  // A published viewport of the same width keeps its own height.
  return published?.width === base.width
    ? { width: base.width, height: published.height }
    : base;
}

/** The CSS scale that draws a `size` frame inside `container`. */
export function frameScale(
  size: { width: number; height: number },
  container: { width: number; height: number },
  fit: "width" | "both",
): number {
  if (size.width <= 0 || container.width <= 0) return 1;
  const byWidth = container.width / size.width;
  if (fit === "width") return byWidth;
  const byHeight =
    container.height > 0 ? container.height / size.height : byWidth;
  return Math.min(1, byWidth, byHeight);
}

/** The client point of a position the frame reported in its own (unscaled) pixels. */
function frameClientPoint(
  frame: HTMLIFrameElement | null,
  at: { readonly x: number; readonly y: number },
): Point | null {
  if (frame === null) return null;
  const rect = frame.getBoundingClientRect();
  const width = frame.offsetWidth;
  const scale = width > 0 ? rect.width / width : 1;
  return { x: rect.left + at.x * scale, y: rect.top + at.y * scale };
}

function useContainerSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, size] as const;
}

export function FrameViewer({
  artifact,
  version,
  mode,
  active,
  onActiveChange,
  review,
  adapterRef,
  onViewChange,
  onHostInput,
  preset,
}: ViewerProps): React.JSX.Element {
  const [containerRef, container] = useContainerSize();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<BridgeHost | null>(null);
  const [doc, setDoc] = useState<DocState | null>(null);
  const docRef = useRef<DocState | null>(null);
  const probes = useRef(
    new Map<number, (point: Extract<FrameMessage, { t: "point" }>) => void>(),
  );
  const probeId = useRef(0);
  // A ref, so a new callback from the canvas never rebuilds the bridge.
  const hostInput = useRef(onHostInput);
  hostInput.current = onHostInput;

  const size = presetSize(preset, version.viewport, container);
  const scale = frameScale(
    size,
    container,
    preset === "responsive" ? "width" : mode === "node" ? "width" : "both",
  );
  const frameMode: FrameMode = active ? mode : "inert";
  const modeRef = useRef({ mode: frameMode, scale });
  modeRef.current = { mode: frameMode, scale };

  // A Mermaid entry is source text; the content host renders the diagram only
  // for the bare token prefix.
  const src =
    artifact.kind === "mermaid"
      ? version.contentUrl
      : contentFileUrl(version, version.entryPath);
  const prefixPathname =
    version.contentUrl === null ? "/" : new URL(version.contentUrl).pathname;
  const commenting = review?.commentMode === true;

  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const host = createBridgeHost(frame, () => modeRef.current, {
      onMessage(message) {
        const next = nextDocState(docRef.current, message, {
          entryPath: version.entryPath,
          prefixPathname,
        });
        if (next !== null) {
          docRef.current = next;
          setDoc(next);
          onViewChange();
          return;
        }
        switch (message.t) {
          case "key":
            // The page owns the keyboard; replay the key where its handlers listen.
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: message.k, bubbles: true }),
            );
            break;
          case "point":
            probes.current.get(message.id)?.(message);
            break;
          case "error":
            console.warn(
              `Artifact "${artifact.title}" reported an error`,
              message.message,
            );
            break;
          case "wheel":
          case "gesture": {
            // The page did not keep this input: the canvas camera takes it. The
            // point is the frame's own client pixels (rounded by the browser);
            // pins never depend on it.
            const client = frameClientPoint(frameRef.current, message);
            const forward = hostInput.current;
            if (client === null || forward === undefined) break;
            forward(
              message.t === "wheel"
                ? {
                    type: "wheel",
                    dx: message.dx,
                    dy: message.dy,
                    ctrl: message.ctrl,
                    client,
                  }
                : { type: "gesture", scale: message.scale, client },
            );
            break;
          }
          case "drawn":
          case "scroll":
          case "nav":
            break;
        }
      },
    });
    bridgeRef.current = host;
    const onWindowMessage = (event: MessageEvent): void => {
      host.handleWindowMessage(event);
    };
    window.addEventListener("message", onWindowMessage);
    return () => {
      window.removeEventListener("message", onWindowMessage);
      host.dispose();
      bridgeRef.current = null;
    };
  }, [
    artifact.title,
    version.entryPath,
    version.id,
    prefixPathname,
    onViewChange,
  ]);

  useEffect(() => {
    bridgeRef.current?.send({ ab: 1, t: "mode", mode: frameMode });
  }, [frameMode]);

  const adapter = useMemo<AnchorAdapter>(() => {
    function measure() {
      const frame = frameRef.current;
      if (frame === null) return null;
      const rect = frame.getBoundingClientRect();
      const width = frame.offsetWidth;
      return {
        rect,
        scale: width > 0 ? rect.width / width : 1,
        viewportWidth: width,
      };
    }
    function localAnchor(point: Point) {
      const measured = measure();
      if (measured === null || !contains(measured.rect, point)) return null;
      const current = docRef.current;
      if (current === null || current.width <= 0)
        return frameAnchor(measured.rect, point);
      const pixels = clientToFramePixels(measured.rect, measured.scale, point);
      return pixels === null
        ? null
        : docAnchorFromFramePixels(pixels, current, measured.viewportWidth);
    }
    return {
      toAnchor: localAnchor,
      toClient(anchor) {
        const measured = measure();
        if (measured === null) return null;
        if (anchor.type === "frame")
          return denormalizeInRect(measured.rect, anchor);
        const current = docRef.current;
        const readable =
          anchor.type === "doc" &&
          current?.width !== undefined &&
          current.width > 0;
        return readable
          ? framePixelsToClient(
              measured.rect,
              measured.scale,
              framePixelsFromDocAnchor(anchor, current, measured.viewportWidth),
            )
          : null;
      },
      probe(point) {
        const measured = measure();
        const host = bridgeRef.current;
        const pixels =
          measured === null
            ? null
            : clientToFramePixels(measured.rect, measured.scale, point);
        if (
          host === null ||
          measured === null ||
          pixels === null ||
          !host.connected()
        )
          return Promise.resolve(localAnchor(point));
        probeId.current += 1;
        const id = probeId.current;
        return new Promise((resolve) => {
          const done = (anchor: ReturnType<typeof localAnchor>): void => {
            clearTimeout(timer);
            probes.current.delete(id);
            resolve(anchor);
          };
          const timer = setTimeout(() => {
            done(localAnchor(point));
          }, PROBE_TIMEOUT_MS);
          probes.current.set(id, (answer) => {
            done(
              docAnchorFromPoint(
                answer,
                docRef.current ?? { width: 0, path: version.entryPath },
                measured.viewportWidth,
              ),
            );
          });
          host.send({ ab: 1, t: "probe", id, x: pixels.x, y: pixels.y });
        });
      },
      reveal(anchor) {
        if (anchor.type !== "doc") return;
        const current = docRef.current;
        const ratio =
          current !== null && current.width > 0
            ? current.width / anchor.docWidth
            : 1;
        bridgeRef.current?.send({
          ab: 1,
          t: "scrollTo",
          x: 0,
          y: Math.max(0, anchor.y * ratio - 120),
        });
      },
      approximate: (anchor) => anchor.type === "frame",
    };
  }, [version.entryPath]);

  useAdapterRegistration(adapterRef, adapter, onViewChange);

  useEffect(() => {
    onViewChange();
  }, [scale, size.width, size.height, onViewChange]);

  const activate = useCallback(() => {
    onActiveChange(true);
    requestAnimationFrame(() => frameRef.current?.focus());
  }, [onActiveChange]);

  if (src === null)
    return <p className="ar-note">This version’s files were deleted.</p>;

  const connected = doc !== null;
  const wrapperStyle =
    preset === "responsive" || mode === "node"
      ? { width: "100%", height: "100%" }
      : { width: size.width * scale, height: size.height * scale };

  return (
    <div className="ar-frame-viewer" ref={containerRef} data-mode={mode}>
      <div
        className="ar-frame-box"
        style={wrapperStyle}
        data-active={active}
        data-bridge={connected ? "connected" : "none"}
      >
        <iframe
          ref={frameRef}
          className="ar-frame"
          data-testid="artifact-frame"
          title={`${artifact.title}, version ${String(version.number)}`}
          src={src}
          sandbox={FRAME_SANDBOX}
          referrerPolicy="no-referrer"
          allow=""
          loading="eager"
          inert={!active}
          style={{
            width: size.width,
            height: size.height,
            transform: `scale(${String(scale)})`,
          }}
        />
        {commenting ? (
          <div
            className="ar-frame-catcher"
            data-testid="comment-catcher"
            onWheel={(event) => {
              // The frame is not interactive here, so the page scrolls it.
              const current = docRef.current;
              if (current === null) return;
              bridgeRef.current?.send({
                ab: 1,
                t: "scrollTo",
                x: Math.max(0, current.scrollX + event.deltaX / scale),
                y: Math.max(0, current.scrollY + event.deltaY / scale),
              });
            }}
          />
        ) : active || mode === "node" ? null : (
          <button
            type="button"
            className="ar-frame-activate"
            onClick={activate}
          >
            <PointerIcon aria-hidden="true" />
            <span>Click to interact</span>
          </button>
        )}
      </div>
      {/* On the canvas the Exit chip is part of the unscaled overlay. */}
      {active && mode === "focus" ? (
        <button
          type="button"
          className="ar-exit-chip"
          aria-keyshortcuts="Escape"
          onClick={() => {
            onActiveChange(false);
          }}
        >
          <LogOutIcon aria-hidden="true" />
          Exit <kbd>Esc</kbd>
        </button>
      ) : null}
      {mode === "focus" && !connected ? (
        <span className="ar-badge-approx" role="status">
          Pins are approximate: this page did not report its layout.
        </span>
      ) : null}
    </div>
  );
}
