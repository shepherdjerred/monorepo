import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@scout-for-lol/design-system/components/card";
import {
  LoadingState,
  ErrorState,
} from "@scout-for-lol/design-system/domain/states";
import {
  getChampionDisplayName,
  gameResultTimestamp,
  resolveQueueTypeFromGame,
  queueTypeToDisplayString,
} from "@scout-for-lol/data";
import { useTRPC, type RouterOutputs } from "#src/lib/query/trpc.ts";

type Results = RouterOutputs["scoutClient"]["results"];

function resultTitle(game: Results["results"][number]): string {
  if (game.gameType === "CUSTOM_GAME") return "Custom game";
  const queue = resolveQueueTypeFromGame(
    game.queueId,
    game.gameMode,
    game.gameType,
  );
  return queue === undefined ? game.gameMode : queueTypeToDisplayString(queue);
}

/** A scoreboard can show known facts even when the full report lacks inputs. */
export function ScoutClientHistoryView(props: { readonly data: Results }) {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Recovered games</h1>
        <p className="text-sm text-scout-subtle">
          Recent games from your paired Scout Client, enriched with available
          Riot results. A dash means the statistic was unavailable.
        </p>
      </header>
      {props.data.conflicts.map((conflict) => (
        <Card key={conflict.matchId}>
          <CardHeader>
            <CardTitle>{conflict.matchId}</CardTitle>
            <CardDescription>
              Result unresolved. The available observations disagree; the
              scoreboard will appear when the result can be verified.
            </CardDescription>
          </CardHeader>
        </Card>
      ))}
      {props.data.results.length === 0 && props.data.conflicts.length === 0 ? (
        <p className="text-sm text-scout-subtle">
          No recovered games yet. Keep Scout Client running while League is open
          to collect available match history.
        </p>
      ) : null}
      {props.data.results.map((game) => (
        <Card key={game.matchId}>
          <CardHeader>
            <CardTitle>
              {resultTitle(game)} · {game.matchId}
            </CardTitle>
            <CardDescription>
              {new Date(gameResultTimestamp(game)).toLocaleString()} ·{" "}
              {Math.round(game.durationSeconds / 60).toString()} min
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Scoreboard for {game.matchId}
                </caption>
                <thead className="text-scout-subtle">
                  <tr>
                    {[
                      "Player",
                      "Result",
                      "K / D / A",
                      "Gold",
                      "Damage",
                      "CS",
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="whitespace-nowrap px-3 py-2 font-medium"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {game.participants.map((player, index) => (
                    <tr
                      key={
                        player.participantId === null
                          ? `slot:${index.toString()}`
                          : `participant:${player.participantId.toString()}`
                      }
                      className="border-t border-scout-line"
                    >
                      <th scope="row" className="px-3 py-3 font-medium">
                        <span className="block whitespace-nowrap">
                          {player.name ??
                            (player.identity.kind === "bot"
                              ? "Bot"
                              : "Unknown player")}
                        </span>
                        <span className="text-xs font-normal text-scout-subtle">
                          {getChampionDisplayName(player.championId)}
                        </span>
                      </th>
                      <td className="px-3 py-3">
                        {player.win ? "Win" : "Loss"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {player.kills ?? "—"} / {player.deaths ?? "—"} /{" "}
                        {player.assists ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        {player.gold?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        {player.damageToChampions?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-3 py-3">{player.minions ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </main>
  );
}

export function ScoutClientHistory() {
  const trpc = useTRPC();
  const results = useQuery(
    trpc.scoutClient.results.queryOptions({ limit: 20 }),
  );
  if (results.isPending)
    return <LoadingState label="Loading recovered games…" />;
  return results.isError ? (
    <ErrorState message={results.error.message} />
  ) : (
    <ScoutClientHistoryView data={results.data} />
  );
}
