import { Loaded } from "@shepherdjerred/loaded";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { LiveListView } from "#src/components/live/live-list-view.tsx";
import {
  LiveLoading,
  LiveUnavailable,
} from "#src/components/live/live-shell.tsx";
import { track } from "#src/lib/analytics.ts";
import { LIVE_REFRESH_MS } from "#src/lib/live/live-game.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

/** The games the viewer's friends are in right now. */
export function ConsumerLive() {
  const trpc = useTRPC();
  const games = useQuery(
    trpc.consumerLive.list.queryOptions(
      {},
      { refetchInterval: LIVE_REFRESH_MS },
    ),
  );
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || (!games.isSuccess && !games.isError)) return;
    opened.current = true;
    track("live_games_opened", {
      outcome: games.isSuccess ? "succeeded" : "failed",
    });
  }, [games.isError, games.isSuccess]);

  // The list is re-scoped to the viewer's servers on every read, so a failed
  // refresh is the access recheck: `strict` drops the retained list rather than
  // keep showing games that outlived the permission behind them.
  const loaded = Loaded.strict(Loaded.fromQuery(games, ["live"]));
  if (loaded.status === "loading") return <LiveLoading />;
  if (loaded.status === "error") {
    return (
      <LiveUnavailable
        title="Live games unavailable"
        onRetry={() => void games.refetch()}
      />
    );
  }
  return <LiveListView games={loaded.data} now={games.dataUpdatedAt} />;
}
