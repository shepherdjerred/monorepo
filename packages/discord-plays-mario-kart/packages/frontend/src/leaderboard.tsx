import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LeaderboardEntry,
  Response,
} from "@discord-plays-mario-kart/common";
import { socket } from "./socket.ts";
import {
  LEADERBOARD_QUERY_KEY,
  requestLeaderboard,
} from "./leaderboard-query.ts";

/**
 * Small all-time leaderboard. The initial board is a request/response pair, so
 * it is a query; the server also pushes an unsolicited broadcast after each
 * race, which writes straight into the same cache entry rather than a second
 * copy of the state.
 */
export function Leaderboard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: LEADERBOARD_QUERY_KEY,
    queryFn: requestLeaderboard,
  });

  useEffect(() => {
    const onResponse = (response: Response) => {
      if (response.kind !== "leaderboard") return;
      queryClient.setQueryData<LeaderboardEntry[]>(
        LEADERBOARD_QUERY_KEY,
        response.value.entries,
      );
    };
    socket.on("response", onResponse);
    return () => {
      socket.off("response", onResponse);
    };
  }, [queryClient]);

  const entries = query.data ?? [];
  const loaded = query.data !== undefined;

  return (
    <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <h2 className="mb-2 text-sm font-black uppercase tracking-[0.18em] text-zinc-400">
        Leaderboard
      </h2>
      {loaded ? (
        entries.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No races recorded yet. Set a name and race to get on the board.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="w-8 font-semibold">#</th>
                <th className="font-semibold">Player</th>
                <th className="w-10 text-right font-semibold">W</th>
                <th className="w-12 text-right font-semibold">R</th>
                <th className="w-14 text-right font-semibold">%</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.name} className="border-t border-zinc-800/60">
                  <td className="py-1 text-zinc-500">{i + 1}</td>
                  <td className="py-1 font-semibold text-zinc-100">{e.name}</td>
                  <td className="py-1 text-right text-emerald-400">{e.wins}</td>
                  <td className="py-1 text-right text-zinc-300">{e.races}</td>
                  <td className="py-1 text-right text-zinc-300">
                    {Math.round(e.winRate * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <p className="text-sm text-zinc-500">Loading…</p>
      )}
    </div>
  );
}
