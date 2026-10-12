import type { PlaybackCommandServiceDeps } from "./playback-command-types.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import { isRemoteArtworkUrl } from "@shepherdjerred/streambot/metadata/public-artwork.ts";

export function dispatchPlayRequest(
  deps: PlaybackCommandServiceDeps,
  input: {
    source: Source;
    userId: UserId;
    placement: "queue" | "next" | "now";
    label: string;
    thumbnailUrl: string | undefined;
    preResolved: ResolvedSource | undefined;
    sports: boolean;
    requestId: string | undefined;
  },
): void {
  const { source, userId, placement, preResolved, requestId } = input;
  const type =
    placement === "now"
      ? "PLAY_NOW"
      : placement === "next"
        ? "ADD_NEXT"
        : "ADD";
  const thumbnailUrl =
    input.thumbnailUrl !== undefined && isRemoteArtworkUrl(input.thumbnailUrl)
      ? input.thumbnailUrl
      : undefined;
  const retainResolved =
    preResolved !== undefined && !(placement !== "now" && input.sports);
  try {
    deps.assertCurrent?.();
    deps.dispatch({
      type,
      source,
      requesterId: userId,
      queuedAt: Date.now(),
      display: {
        title: input.label,
        ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
        ...(preResolved?.durationSeconds === undefined
          ? {}
          : { durationSeconds: preResolved.durationSeconds }),
      },
      ...(requestId === undefined ? {} : { requestId }),
      // Signed sports URLs are resolved again from their stable page at playback time.
      ...(retainResolved ? { preResolved } : {}),
    });
  } catch (error) {
    if (requestId !== undefined)
      deps.history?.updateRequest(requestId, "failed");
    throw error;
  }
}
