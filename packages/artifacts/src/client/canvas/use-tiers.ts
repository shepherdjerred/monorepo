import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useArtifactDetails } from "#client/data/queries.ts";
import type { ArtifactDetail } from "#client/data/api.ts";
import type { AnchorAdapter } from "#client/viewers/types.ts";
import { visibleRect, type Size } from "./camera.ts";
import type { FrameTier } from "./canvas-frame.tsx";
import type { CanvasFrameModel } from "./model.ts";
import type { SettledCamera } from "./use-camera.ts";
import { selectPreviews } from "./tiers.ts";

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

export type FrameTiers = {
  readonly tierOf: (id: string) => FrameTier;
  readonly detailById: ReadonlyMap<string, ArtifactDetail>;
  readonly requestLoad: (id: string) => void;
  /** One stable adapter slot per frame; the viewer fills it. */
  readonly adapterFor: (id: string) => { current: AnchorAdapter | null };
  readonly adapters: ReadonlyMap<string, { current: AnchorAdapter | null }>;
};

/**
 * Which frames render a preview (see `tiers.ts`), re-evaluated when the camera
 * settles, frames change, the cap drops, or the reviewer asks for a frame. The
 * live frame is always rendered and does not count against the cap; when it
 * exits it is kept like any other preview.
 */
export function useFrameTiers({
  frames,
  settled,
  size,
  cap,
  activeId,
}: {
  readonly frames: readonly CanvasFrameModel[];
  readonly settled: SettledCamera;
  readonly size: Size;
  readonly cap: number;
  readonly activeId: string | null;
}): FrameTiers {
  const [previews, setPreviews] = useState<ReadonlySet<string>>(new Set());
  const [requested, setRequested] = useState<readonly string[]>([]);

  useEffect(() => {
    const view = visibleRect(settled.camera, size);
    setPreviews((current) => {
      const next = selectPreviews({
        frames: frames.map((frame) => ({
          id: frame.id,
          kind: frame.summary.kind,
          rect: frame.rect,
        })),
        view,
        mounted: current,
        requested,
        liveId: activeId,
        cap,
        evictFar: settled.kind === "pan",
      });
      // The live frame stays in the set, so leaving it never unmounts the
      // iframe for a render (which would reload it).
      if (activeId !== null) next.add(activeId);
      return sameSet(current, next) ? current : next;
    });
  }, [frames, settled, size, requested, activeId, cap]);

  const mountedIds = useMemo(() => {
    const ids = new Set(previews);
    if (activeId !== null) ids.add(activeId);
    return frames.filter((frame) => ids.has(frame.id)).map((frame) => frame.id);
  }, [previews, activeId, frames]);
  const details = useArtifactDetails(mountedIds);
  const detailById = new Map(
    mountedIds.flatMap((id, position) => {
      const detail = details[position]?.data;
      return detail === undefined ? [] : [[id, detail] as const];
    }),
  );

  const adapters = useRef(new Map<string, { current: AnchorAdapter | null }>());
  const adapterFor = useCallback((id: string) => {
    const known = adapters.current.get(id);
    if (known !== undefined) return known;
    const created: { current: AnchorAdapter | null } = { current: null };
    adapters.current.set(id, created);
    return created;
  }, []);

  const requestLoad = useCallback((id: string) => {
    setRequested((current) => [...current.filter((entry) => entry !== id), id]);
  }, []);

  const tierOf = (id: string): FrameTier =>
    id === activeId || previews.has(id) ? "preview" : "placeholder";

  return {
    tierOf,
    detailById,
    requestLoad,
    adapterFor,
    adapters: adapters.current,
  };
}
