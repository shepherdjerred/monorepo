import type { Anchor, ArtifactKind } from "@shepherdjerred/artifacts/contract";
import type { VersionView } from "@shepherdjerred/artifacts/procedures";
import type { Point } from "#client/lib/geometry.ts";
import type { Pin } from "#client/lib/pins.ts";

/**
 * What every viewer exposes so pins work the same everywhere. A point is in
 * client (viewport) coordinates; `null` means the point is not on content, or
 * the anchor is not visible right now.
 */
export type AnchorAdapter = {
  toAnchor: (clientPoint: Point) => Anchor | null;
  toClient: (anchor: Anchor) => Point | null;
  /** Frames only: asks the frame itself what is under the point, then falls back to `toAnchor`. */
  probe?: (clientPoint: Point) => Promise<Anchor | null>;
  /** Scrolls, seeks or turns the page so the anchor is on screen. */
  reveal?: (anchor: Anchor) => void;
  /** True for anchors that are a guess (a frame with no bridge). */
  approximate?: (anchor: Anchor) => boolean;
};

export type ViewerMode = "node" | "focus";

/** What the reviewer is doing to this viewer; only the focused view passes it. */
export type ReviewState = {
  readonly commentMode: boolean;
  readonly pins: readonly Pin[];
  readonly selectedId: string | null;
  readonly onSelect: (threadId: string) => void;
  readonly onPlace: (anchor: Anchor, at: Point) => void;
};

export type ViewerArtifact = {
  readonly id: string;
  readonly title: string;
  readonly kind: ArtifactKind;
};

/** Input a live frame forwarded over the bridge for the host to apply to its camera. */
export type HostInput =
  | {
      readonly type: "wheel";
      readonly dx: number;
      readonly dy: number;
      readonly ctrl: boolean;
      /** Client coordinates (the browser rounds what the frame reports). */
      readonly client: Point;
    }
  | {
      readonly type: "gesture";
      /** Cumulative scale since the gesture started. */
      readonly scale: number;
      readonly client: Point;
    };

export type ViewerProps = {
  readonly artifact: ViewerArtifact;
  readonly version: VersionView;
  readonly mode: ViewerMode;
  /** The frame the reviewer is interacting with (HTML frames only). */
  readonly active: boolean;
  readonly onActiveChange: (active: boolean) => void;
  readonly review: ReviewState | null;
  /** Viewers write their adapter here; the stage reads it to place pins. */
  readonly adapterRef: { current: AnchorAdapter | null };
  /** Called when the view moved (scroll, zoom, resize, page turn): pins reposition. */
  readonly onViewChange: () => void;
  /** Wheel and gesture input a live frame did not keep (canvas only). */
  readonly onHostInput?: ((input: HostInput) => void) | undefined;
  /** Frame viewport preset; ignored by other kinds. */
  readonly preset: PresetId;
};

export type PresetId = "mobile" | "tablet" | "desktop" | "responsive";

/** Absolute URL of a file inside the version's content prefix. */
export function contentFileUrl(
  version: VersionView,
  path: string,
): string | null {
  if (version.contentUrl === null) return null;
  const encoded = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return new URL(encoded, version.contentUrl).href;
}
