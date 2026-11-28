import type { Anchor } from "@shepherdjerred/artifacts/contract";
import type { ThreadView } from "@shepherdjerred/artifacts/procedures";

/** One thread as the viewers and the pin overlay see it. */
export type Pin = {
  readonly id: string;
  /** The thread's 1-based position in the sidebar. */
  readonly index: number;
  readonly anchor: Anchor;
  readonly state: "open" | "resolved";
  /** True when the thread was opened on a version other than the one shown. */
  readonly stale: boolean;
  readonly versionNumber: number | null;
};

/** Threads that point at a place in an artifact: everything but `general` and `board`. */
export function isPlaced(anchor: Anchor): boolean {
  return anchor.type !== "general" && anchor.type !== "board";
}

/**
 * True when a thread was opened on a different version than the one being
 * viewed. It drives the "on vN" badge, the "View on vN" action and the hollow
 * pin together, so they always agree. Unknown versions are never "other".
 */
export function isOtherVersion(
  threadVersion: number | null,
  viewedVersion: number | null,
): boolean {
  return (
    threadVersion !== null &&
    viewedVersion !== null &&
    threadVersion !== viewedVersion
  );
}

export function pinsOf(
  threads: readonly ThreadView[],
  shownVersion: number | null,
): Pin[] {
  const pins: Pin[] = [];
  for (const [position, thread] of threads.entries()) {
    if (!isPlaced(thread.anchor)) continue;
    pins.push({
      id: thread.id,
      index: position + 1,
      anchor: thread.anchor,
      state: thread.state,
      stale: isOtherVersion(thread.versionNumber, shownVersion),
      versionNumber: thread.versionNumber,
    });
  }
  return pins;
}

export function anchorLabel(anchor: Anchor): string {
  switch (anchor.type) {
    case "general":
      return "General";
    case "board":
      return "Board";
    case "frame":
      return "On the page";
    case "doc":
      return "On the page";
    case "page":
      return `Page ${String(anchor.page)}`;
    case "time": {
      const whole = Math.floor(anchor.t);
      return `At ${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
    }
  }
}
