/**
 * Which frames render their content. A frame is in one of three tiers:
 *
 * - live: the one frame the reviewer is interacting with; never counted.
 * - preview: an inert copy of the content, at most `cap` of them.
 * - placeholder: the typed card, which costs nothing.
 *
 * A mounted preview is expensive to bring back (an iframe reloads), so the
 * choice has hysteresis: previews stay until they are far outside the view,
 * visible frames never evict each other, and a settle that only zooms never
 * evicts anything for being off-screen.
 */
import type { ArtifactKind } from "@shepherdjerred/artifacts/contract";
import { centreOf, expandRect, intersects, type WorldRect } from "./camera.ts";

export const DEFAULT_PREVIEW_CAP = 8;
export const FIREFOX_PREVIEW_CAP = 4;
export const MIN_PREVIEW_CAP = 3;
/** A preview this many view-sizes away from the view is released when the camera panned. */
export const FAR_MARGIN = 1;
/** A frame this close to the view (as a fraction of its size) counts as visible, to start loading early. */
export const PREFETCH_MARGIN = 0.1;

export type TierFrame = {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly rect: WorldRect;
};

export type TierInput = {
  readonly frames: readonly TierFrame[];
  /** The world rectangle the viewport shows. */
  readonly view: WorldRect;
  /** The previews mounted at the last evaluation. */
  readonly mounted: ReadonlySet<string>;
  /** Frames the reviewer asked to load, oldest first. */
  readonly requested: readonly string[];
  readonly liveId: string | null;
  readonly cap: number;
  /** True after a pan; a zoom-only settle keeps every preview that fits the cap. */
  readonly evictFar: boolean;
};

function distance(frame: TierFrame, view: WorldRect): number {
  const a = centreOf(frame.rect);
  const b = centreOf(view);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The ids of the frames that render a preview (the live frame is separate). */
export function selectPreviews(input: TierInput): Set<string> {
  const { frames, view, mounted, requested, liveId, cap, evictFar } = input;
  const candidates = frames.filter(
    (frame) => frame.kind !== "file" && frame.id !== liveId,
  );
  const near = expandRect(view, FAR_MARGIN);
  const visibleArea = expandRect(view, PREFETCH_MARGIN);
  const asked = new Set(requested);
  const byDistance = (a: TierFrame, b: TierFrame): number =>
    distance(a, view) - distance(b, view);

  const kept = candidates.filter(
    (frame) =>
      mounted.has(frame.id) && (!evictFar || intersects(frame.rect, near)),
  );

  // What the reviewer asked for competes with what is mounted. Over the cap
  // (it dropped, or frames were requested) keep requested first, then visible,
  // then the nearest to the centre of the view.
  const rank = (frame: TierFrame): number =>
    asked.has(frame.id) ? 0 : intersects(frame.rect, view) ? 1 : 2;
  const askedFrames = candidates.filter(
    (frame) => asked.has(frame.id) && !kept.includes(frame),
  );
  const survivors = [...kept, ...askedFrames]
    .sort((a, b) => rank(a) - rank(b) || byDistance(a, b))
    .slice(0, Math.max(0, cap));
  const next = new Set(survivors.map((frame) => frame.id));

  // Fill free slots with what is on screen, nearest first. Nothing already
  // mounted is evicted for these.
  const onScreen = candidates
    .filter((frame) => intersects(frame.rect, visibleArea))
    .sort(byDistance);
  for (const frame of onScreen) {
    if (next.size >= cap) break;
    next.add(frame.id);
  }
  return next;
}

export function initialPreviewCap(userAgent: string): number {
  return /\bFirefox\//u.test(userAgent)
    ? FIREFOX_PREVIEW_CAP
    : DEFAULT_PREVIEW_CAP;
}

/** The slowest frames, as a percentile of the intervals between them. */
export function percentile(
  values: readonly number[],
  fraction: number,
): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[at] ?? 0;
}

export const SLOW_FRAME_MS = 25;
export const MOTION_WINDOW_MS = 2000;
export const MIN_MOTION_FRAMES = 20;
export const CAP_STEP = 2;

/**
 * The preview cap after a stretch of camera motion. `frameTimes` are rAF
 * timestamps in ascending order; if the 95th percentile of the intervals in
 * the last two seconds is slow, the cap drops by two (never below three).
 * A short burst of motion proves nothing and leaves the cap alone.
 */
export function adaptPreviewCap(
  cap: number,
  frameTimes: readonly number[],
): number {
  const end = frameTimes.at(-1);
  if (end === undefined) return cap;
  const recent = frameTimes.filter((time) => time >= end - MOTION_WINDOW_MS);
  if (recent.length < MIN_MOTION_FRAMES) return cap;
  const intervals = recent
    .slice(1)
    .map((time, at) => time - (recent[at] ?? time));
  return percentile(intervals, 0.95) > SLOW_FRAME_MS
    ? Math.max(MIN_PREVIEW_CAP, cap - CAP_STEP)
    : cap;
}
