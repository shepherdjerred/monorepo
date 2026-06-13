import { useEffect, useState } from "react";
import type {
  LeaderboardEntry,
  Response,
} from "@discord-plays-mario-kart/common";
import { socket } from "./socket.ts";

/**
 * Small all-time leaderboard. Requests the board on mount and also listens for
 * the unsolicited broadcast the server pushes after each race completes.
 */
export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onResponse = (response: Response) => {
      if (response.kind === "leaderboard") {
        setEntries(response.value.entries);
        setLoaded(true);
      }
    };
    socket.on("response", onResponse);
    socket.emit("request", { kind: "leaderboard" });
    return () => {
      socket.off("response", onResponse);
    };
  }, []);

  return (
    <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      <h2 className="mb-2 text-lg font-bold text-emerald-400">Leaderboard</h2>
      {loaded ? (
        entries.length === 0 ? (
          <p className="text-sm text-slate-400">
            No races recorded yet. Set a name and race to get on the board!
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="w-8 font-medium">#</th>
                <th className="font-medium">Player</th>
                <th className="w-12 text-right font-medium">Wins</th>
                <th className="w-14 text-right font-medium">Races</th>
                <th className="w-14 text-right font-medium">Win %</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.name} className="border-t border-slate-700/60">
                  <td className="py-1 text-slate-500">{i + 1}</td>
                  <td className="py-1 font-semibold text-slate-100">
                    {e.name}
                  </td>
                  <td className="py-1 text-right text-emerald-400">{e.wins}</td>
                  <td className="py-1 text-right text-slate-300">{e.races}</td>
                  <td className="py-1 text-right text-slate-300">
                    {Math.round(e.winRate * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <p className="text-sm text-slate-400">Loading…</p>
      )}
    </div>
  );
}
