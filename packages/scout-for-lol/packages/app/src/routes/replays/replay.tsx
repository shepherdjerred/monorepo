import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useParams } from "react-router";
import type { ReplaySessionState } from "@scout-for-lol/replay";
import { ReplayAnalysis } from "#src/components/replay/replay-analysis.tsx";
import { ReplayPageView } from "#src/components/replay/replay-page-view.tsx";
import { ReplayPlayer } from "#src/components/replay/replay-player.tsx";
import {
  publicReplayQuery,
  publicReplayTimelineQuery,
} from "#src/lib/replay/api.ts";
import { replayShareUrl } from "#src/lib/replay/share-state.ts";

/** Public shared replay pages deliberately live outside RequireSession. */
export function PublicReplay() {
  const { replayId = "" } = useParams();
  const location = useLocation();
  const currentState = useRef<ReplaySessionState | null>(null);
  useEffect(() => {
    currentState.current = null;
  }, [replayId]);
  const replay = useQuery(publicReplayQuery(replayId));
  const analysis = useQuery(
    publicReplayTimelineQuery(replayId, replay.isSuccess),
  );
  return (
    <ReplayPageView
      key={replayId}
      state={
        replay.isPending
          ? { status: "loading" }
          : replay.isError
            ? { status: "error", message: replay.error.message }
            : { status: "loaded", replay: replay.data }
      }
      onRetry={() => {
        void replay.refetch();
      }}
      onShare={() =>
        navigator.clipboard.writeText(
          replayShareUrl(globalThis.location.href, currentState.current),
        )
      }
      analysis={
        <ReplayAnalysis
          key={location.key}
          search={location.search}
          durationSeconds={replay.data?.durationSeconds ?? null}
          state={
            analysis.isPending
              ? { status: "loading" }
              : analysis.isError
                ? {
                    status: "error",
                    retry: () => {
                      void analysis.refetch();
                    },
                  }
                : analysis.data.timeline === null
                  ? { status: "unavailable" }
                  : { status: "ready", timeline: analysis.data.timeline }
          }
        />
      }
    >
      {replay.data?.playback.status === "available" && (
        <ReplayPlayer
          key={replay.data.replayId}
          replay={replay.data}
          search={location.search}
          onState={(state) => {
            currentState.current = state;
          }}
        />
      )}
    </ReplayPageView>
  );
}
