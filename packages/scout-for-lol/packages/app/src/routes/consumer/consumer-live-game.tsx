import { Loaded } from "@shepherdjerred/loaded";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { LiveGameView } from "#src/components/live/live-game-view.tsx";
import {
  LiveGameGone,
  LiveLoading,
  LiveUnavailable,
} from "#src/components/live/live-shell.tsx";
import { track } from "#src/lib/analytics.ts";
import { LIVE_REFRESH_MS } from "#src/lib/live/live-game.ts";
import { isGameNotFound } from "#src/lib/live/live-errors.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { useConsumerLiveGameParams } from "#src/lib/routes/route-params.ts";

/** One game's lobby. It keeps refreshing until the game is over. */
export function ConsumerLiveGame() {
  const { riotMatchId } = useConsumerLiveGameParams();
  const trpc = useTRPC();
  const game = useQuery(
    trpc.consumerLive.game.queryOptions(
      { riotMatchId },
      {
        refetchInterval: (query) =>
          query.state.data?.ended === true ? false : LIVE_REFRESH_MS,
        // Asking again cannot turn "no such game" into one.
        retry: (count, error) => !isGameNotFound(error) && count < 3,
      },
    ),
  );
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || (!game.isSuccess && !game.isError)) return;
    opened.current = true;
    track("live_game_opened", {
      outcome: game.isSuccess ? "succeeded" : "failed",
    });
  }, [game.isError, game.isSuccess]);

  // Scope is re-resolved on every read: `strict` drops the retained lobby when
  // a refresh fails, so a lobby never outlives the access behind it.
  const loaded = Loaded.strict(Loaded.fromQuery(game, ["liveGame"]));
  if (loaded.status === "loading") return <LiveLoading />;
  if (loaded.status === "error") {
    return isGameNotFound(game.error) ? (
      <LiveGameGone />
    ) : (
      <LiveUnavailable
        title="This game could not be loaded"
        onRetry={() => void game.refetch()}
      />
    );
  }
  return <LiveGameView game={loaded.data} now={game.dataUpdatedAt} />;
}
