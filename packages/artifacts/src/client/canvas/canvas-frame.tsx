import { memo, useMemo } from "react";
import type { Anchor } from "@shepherdjerred/artifacts/contract";
import type { ArtifactDetail } from "#client/data/api.ts";
import type { Point } from "#client/lib/geometry.ts";
import { noop } from "#client/lib/noop.ts";
import { ArtifactViewer } from "#client/viewers/artifact-viewer.tsx";
import type { AnchorAdapter, HostInput } from "#client/viewers/types.ts";
import type { CanvasFrameModel } from "./model.ts";
import { Placeholder } from "./placeholder.tsx";

export type FrameTier = "preview" | "placeholder";

type Props = {
  readonly model: CanvasFrameModel;
  readonly detail: ArtifactDetail | undefined;
  readonly tier: FrameTier;
  /** The one frame the reviewer is interacting with. */
  readonly active: boolean;
  /** Comment mode: a click on the frame places a pin on it. */
  readonly commenting: boolean;
  readonly adapterRef: { current: AnchorAdapter | null };
  readonly onRequestLoad: (id: string) => void;
  readonly onPlace: (id: string, anchor: Anchor, at: Point) => void;
  readonly onHostInput: (input: HostInput) => void;
  readonly onViewChange: () => void;
};

/**
 * One frame in the world layer. Its tree is the same whether it is selected,
 * live or neither: only attributes change (`inert`, `data-*`), so the iframe
 * inside is never remounted, which would reload it. Stacking is CSS `z-index`
 * from the index `order`; the DOM order never changes with it.
 */
export const CanvasFrame = memo(function CanvasFrameView({
  model,
  detail,
  tier,
  active,
  commenting,
  adapterRef,
  onRequestLoad,
  onPlace,
  onHostInput,
  onViewChange,
}: Props): React.JSX.Element {
  const { rect, summary, z } = model;
  const version = detail?.current ?? null;
  const review = useMemo(
    () =>
      commenting
        ? {
            commentMode: true,
            pins: [],
            selectedId: null,
            onSelect: noop,
            onPlace: (anchor: Anchor, at: Point) => {
              onPlace(summary.id, anchor, at);
            },
          }
        : null,
    [commenting, onPlace, summary.id],
  );

  return (
    <div
      className="ar-cf"
      data-frame-id={summary.id}
      data-testid="canvas-frame"
      data-tier={tier}
      data-kind={summary.kind}
      data-active={active}
      style={{
        transform: `translate(${String(rect.x)}px, ${String(rect.y)}px)`,
        width: rect.w,
        height: rect.h,
        zIndex: z + 1,
      }}
    >
      {tier === "preview" && version !== null ? (
        // Previews are inert: a pointer never reaches the content. The reviewer
        // interacts with one frame at a time (double-click or Enter).
        <div className="ar-cf-body" inert={!active && !commenting}>
          <ArtifactViewer
            artifact={{
              id: summary.id,
              title: summary.title,
              kind: summary.kind,
            }}
            version={version}
            mode="node"
            active={active}
            adapterRef={adapterRef}
            review={review}
            preset="desktop"
            onViewChange={onViewChange}
            onHostInput={onHostInput}
          />
        </div>
      ) : (
        <div className="ar-cf-body">
          <Placeholder
            summary={summary}
            onLoad={
              tier === "preview" || summary.kind === "file"
                ? null
                : () => {
                    onRequestLoad(summary.id);
                  }
            }
          />
        </div>
      )}
    </div>
  );
});
