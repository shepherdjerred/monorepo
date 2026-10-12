// Stats over the game socket. Each is a react-query entry keyed by what it
// asked for; the server pushes a fresh leaderboard after every recorded race,
// which also means any player's stats and the race list may have changed.
import { useEffect } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  PlayerRecord,
  PlayerStats,
  RaceSummary,
  Response,
} from "@discord-plays-mario-kart/common";
import { socket } from "#src/socket.ts";
import { socketRequest } from "#src/session/socket-request.ts";

export const LEADERBOARD_KEY = ["leaderboard"] as const;
export const RECENT_RACES_KEY = ["recent-races"] as const;
export const playerStatsKey = (discordId: string) =>
  ["player-stats", discordId] as const;

function requestLeaderboard(): Promise<PlayerRecord[]> {
  return socketRequest({ kind: "leaderboard" }, (response) =>
    response.kind === "leaderboard" ? response.value.entries : undefined,
  );
}

function requestRecentRaces(): Promise<RaceSummary[]> {
  return socketRequest({ kind: "recent-races" }, (response) =>
    response.kind === "recent-races" ? response.value.races : undefined,
  );
}

async function requestPlayerStats(
  discordId: string,
): Promise<PlayerStats | null> {
  const value = await socketRequest(
    { kind: "player-stats", discordId },
    (response) =>
      response.kind === "player-stats" && response.value.discordId === discordId
        ? response.value
        : undefined,
  );
  return value.stats;
}

export function useLeaderboard() {
  return useQuery({ queryKey: LEADERBOARD_KEY, queryFn: requestLeaderboard });
}

export function useRecentRaces() {
  return useQuery({ queryKey: RECENT_RACES_KEY, queryFn: requestRecentRaces });
}

export function usePlayerStats(discordId: string | undefined) {
  return useQuery({
    queryKey: playerStatsKey(discordId ?? ""),
    queryFn: () => requestPlayerStats(discordId ?? ""),
    enabled: discordId !== undefined,
    placeholderData: keepPreviousData,
  });
}

/** Keep every stats view fresh when the server reports a recorded race. */
export function useStatsPush(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const onResponse = (response: Response) => {
      if (response.kind !== "leaderboard") {
        return;
      }
      queryClient.setQueryData<PlayerRecord[]>(
        LEADERBOARD_KEY,
        response.value.entries,
      );
      void queryClient.invalidateQueries({ queryKey: RECENT_RACES_KEY });
      void queryClient.invalidateQueries({ queryKey: ["player-stats"] });
    };
    socket.on("response", onResponse);
    return () => {
      socket.off("response", onResponse);
    };
  }, [queryClient]);
}
