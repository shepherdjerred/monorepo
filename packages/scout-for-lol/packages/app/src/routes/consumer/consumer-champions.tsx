import type { DiscordGuildId } from "@scout-for-lol/data";
import { Loaded } from "@shepherdjerred/loaded";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ChampionsIndexView } from "#src/components/champions/champions-index-view.tsx";
import {
  ChampionsLoading,
  ChampionsUnavailable,
} from "#src/components/champions/champions-shell.tsx";
import { track } from "#src/lib/analytics.ts";
import { championScopeInput } from "#src/lib/champions/champion-pages.ts";
import { usePlayerProfileUrlState } from "#src/lib/player/use-player-profile-url-state.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

/** Champions in the viewer's servers: who plays what, and who is best on it. */
export function ConsumerChampions() {
  const { filters } = usePlayerProfileUrlState();
  const trpc = useTRPC();
  const [guildIds, setGuildIds] = useState<DiscordGuildId[] | undefined>();
  const [find, setFind] = useState("");
  const index = useQuery(
    trpc.consumerChampion.index.queryOptions(
      championScopeInput(filters, guildIds),
      { placeholderData: keepPreviousData },
    ),
  );
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || (!index.isSuccess && !index.isError)) return;
    opened.current = true;
    track("champions_index_opened", {
      outcome: index.isSuccess ? "succeeded" : "failed",
    });
  }, [index.isError, index.isSuccess]);

  // The index is scoped to the viewer's currently enabled shared servers, so a
  // failed refetch is the access recheck: `strict` drops the retained page
  // rather than showing a list that outlived the permission behind it.
  const champions = Loaded.strict(Loaded.fromQuery(index, ["champions"]));
  if (champions.status === "loading") {
    return <ChampionsLoading />;
  }
  if (champions.status === "error") {
    return (
      <ChampionsUnavailable
        title="Champions unavailable"
        lead="Champions could not be loaded."
        onRetry={() => void index.refetch()}
      />
    );
  }
  return (
    <ChampionsIndexView
      data={champions.data}
      guildIds={guildIds}
      onGuildIds={(next) => {
        setGuildIds(next);
        track("champions_filter_changed", { kind: "servers" });
      }}
      find={find}
      onFind={setFind}
    />
  );
}
