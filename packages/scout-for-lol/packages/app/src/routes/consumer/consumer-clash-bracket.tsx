import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

const RESULT_LABEL = { won: "Won", lost: "Lost", pending: "Up next" } as const;

type ClashBracketOpponent =
  RouterOutputs["clash"]["roster"]["brackets"][number]["matches"][number]["opponent"];

/** A bye has no opponent; a listed but unnamed one is still an opponent. */
function opponentLabel(opponent: ClashBracketOpponent): string {
  switch (opponent.kind) {
    case "team":
      return `vs ${opponent.name}`;
    case "unknown":
      return "vs an unnamed team";
    case "bye":
      return "Bye";
  }
}

export function ClashBracketSection(props: {
  brackets: RouterOutputs["clash"]["roster"]["brackets"];
  history?: boolean;
}) {
  if (props.brackets.length === 0) {
    return null;
  }
  return (
    <section
      className="space-y-3"
      aria-labelledby={
        props.history === true
          ? "clash-past-bracket-title"
          : "clash-bracket-title"
      }
    >
      <div>
        <h2
          id={
            props.history === true
              ? "clash-past-bracket-title"
              : "clash-bracket-title"
          }
          className="text-xl font-semibold"
        >
          {props.history === true ? "Past brackets" : "Bracket"}
        </h2>
        <p className="text-sm text-scout-subtle">
          Seen by a tracked player&apos;s Scout Client. Riot does not publish
          brackets or results.
        </p>
      </div>
      <div className="grid gap-3">
        {props.brackets.map((bracket) => (
          <Card
            key={JSON.stringify([
              bracket.platformId,
              bracket.tournamentId,
              bracket.rosterId,
              bracket.capturedAt,
            ])}
          >
            <CardHeader>
              <CardTitle>
                {bracket.abbreviation} · {bracket.name}
              </CardTitle>
              <CardDescription>
                {bracket.tier === null ? "" : `Tier ${String(bracket.tier)} · `}
                {bracket.memberAliases.join(", ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {bracket.matches.length === 0 ? (
                <p className="text-scout-subtle">Bracket not drawn yet.</p>
              ) : null}
              {bracket.matches.map((match, index) => (
                <div
                  key={`${String(match.round ?? index)}:${opponentLabel(match.opponent)}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {match.round === null
                      ? ""
                      : `Round ${String(match.round)} · `}
                    {opponentLabel(match.opponent)}
                  </span>
                  <Badge
                    variant={
                      match.result === "pending" ? "secondary" : "default"
                    }
                  >
                    {RESULT_LABEL[match.result]}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
