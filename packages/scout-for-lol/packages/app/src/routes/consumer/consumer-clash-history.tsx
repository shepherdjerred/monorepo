import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";
import {
  clashTeamLabel,
  formatClashIso,
  sightingOutcomeLabel,
  titleCaseToken,
} from "#src/routes/consumer/consumer-clash-copy.ts";

type QueryView<T> = {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: { message: string } | null;
  data: T | undefined;
};

export function ClashHistorySection(props: {
  history: QueryView<RouterOutputs["clash"]["history"]>;
}) {
  const cups = props.history.data?.cups ?? [];
  const resultsNote =
    props.history.data?.resultsNote ??
    "Past Clash lobbies Scout saw. Current weekends have no score. Games through Feb 2026 may show a result.";
  return (
    <section className="space-y-3" aria-labelledby="clash-history-title">
      <div>
        <h2 id="clash-history-title" className="text-xl font-semibold">
          History
        </h2>
        <p className="text-sm text-scout-subtle">{resultsNote}</p>
      </div>
      {props.history.isPending ? (
        <p className="text-sm text-scout-subtle">Loading history…</p>
      ) : null}
      {props.history.isError ? (
        <p className="text-sm text-scout-danger">
          {props.history.error?.message ?? "Unable to load history"}
        </p>
      ) : null}
      {props.history.isSuccess && cups.length === 0 ? (
        <p className="text-sm text-scout-subtle">
          No past Clash lobbies for tracked players yet.
        </p>
      ) : null}
      <div className="grid gap-3">
        {cups.map((cup) => (
          <Card key={cup.id}>
            <CardHeader>
              <CardTitle>{cup.themeLabel}</CardTitle>
              <CardDescription>{titleCaseToken(cup.queue)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {cup.players.map((player) => {
                const teamLabel = clashTeamLabel(player);
                return (
                  <div key={player.puuid} className="space-y-1 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{player.playerAlias}</span>
                      {teamLabel === undefined ? null : (
                        <span className="text-scout-subtle">{teamLabel}</span>
                      )}
                    </div>
                    {player.sightings.map((sighting) => (
                      <div
                        key={`${sighting.platform}:${sighting.gameId}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-scout-subtle"
                      >
                        <span>
                          Match {String(sighting.matchIndex)} ·{" "}
                          {sighting.championName} ·{" "}
                          {formatClashIso(sighting.observedAt)}
                        </span>
                        <Badge variant="secondary">
                          {sightingOutcomeLabel(sighting.outcome)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
