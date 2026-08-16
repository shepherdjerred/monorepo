import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Crown, ShieldCheck, Trophy } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type {
  CustomGameParticipant,
  CustomGameSnapshot,
} from "@scout-for-lol/data";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { useTRPC } from "#src/lib/trpc.ts";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function label(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function participantName(participant: CustomGameParticipant): string {
  if (participant.riotGameName === null || participant.riotTagLine === null) {
    return participant.displayName;
  }
  return `${participant.riotGameName}#${participant.riotTagLine}`;
}

function Team({ game, team }: { game: CustomGameSnapshot; team: "A" | "B" }) {
  const participants = game.participants
    .filter((participant) => participant.team === team)
    .toSorted((left, right) => left.rosterOrder - right.rosterOrder);
  return (
    <section className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-medium">Team {team}</h4>
        <Badge variant="outline">{team === "A" ? "Blue" : "Red"}</Badge>
      </div>
      <ul className="space-y-1 text-sm">
        {participants.map((participant) => (
          <li
            className="flex items-center justify-between gap-2"
            key={participant.discordId}
          >
            <span>{participantName(participant)}</span>
            {participant.captain && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Crown className="size-3" aria-hidden="true" /> Captain
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function GameCard({ game }: { game: CustomGameSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Game {game.sequence}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{label(game.state)}</Badge>
            {game.winner !== null && (
              <Badge>
                <Trophy className="mr-1 size-3" aria-hidden="true" /> Team{" "}
                {game.winner}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>
          {label(game.map)} · {label(game.pickMode)} · {label(game.rosterMode)}
          {game.resultSource === null
            ? ""
            : ` · ${label(game.resultSource)} result`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Team game={game} team="A" />
          <Team game={game} team="B" />
        </div>
        {game.repeatChampionWarnings.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Consecutive champion warning</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {game.repeatChampionWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryDetailPanel({
  data,
  errorMessage,
  isLoading,
}: {
  data:
    | {
        audit: readonly unknown[];
        games: readonly CustomGameSnapshot[];
      }
    | null
    | undefined;
  errorMessage: string | undefined;
  isLoading: boolean;
}) {
  return (
    <section className="space-y-4" aria-live="polite">
      {isLoading && data === undefined && (
        <p className="text-sm text-muted-foreground">Loading games…</p>
      )}
      {errorMessage !== undefined && (
        <p className="text-sm text-destructive">
          Failed to load: {errorMessage}
        </p>
      )}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            {data.games.length} games · {data.audit.length} audited actions
          </p>
          {data.games.map((game) => (
            <GameCard game={game} key={game.id} />
          ))}
        </>
      )}
    </section>
  );
}

export function CustomsHistory() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const [requestedNightId, setRequestedNightId] = useState<string | null>(null);
  const safeGuildId = guildId ?? "";
  const bootstrap = useQuery(
    trpc.customs.historyBootstrap.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );
  const nights = bootstrap.data?.nights;
  const initialNightId = nights?.[0]?.id;
  const selectedNightId = requestedNightId ?? initialNightId;
  const detail = useQuery(
    trpc.customs.historyDetail.queryOptions(
      {
        guildId: safeGuildId,
        nightId: selectedNightId ?? "00000000-0000-0000-0000-000000000000",
      },
      {
        enabled:
          guildId !== undefined &&
          selectedNightId !== undefined &&
          selectedNightId !== initialNightId,
      },
    ),
  );
  const selectedDetail =
    selectedNightId === initialNightId
      ? bootstrap.data?.initialDetail
      : detail.data;

  if (guildId === undefined) {
    return <p className="p-6 text-sm text-destructive">Missing guild id.</p>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
      <div>
        <Button asChild size="sm" variant="ghost">
          <Link to="/">
            <ArrowLeft aria-hidden="true" /> Back to Scout
          </Link>
        </Button>
        <div className="mt-4 flex items-start gap-3">
          <ShieldCheck
            className="mt-1 size-6 text-primary"
            aria-hidden="true"
          />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Custom game history
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Private to current members of this Discord server. No MMR,
              ranking, leaderboard, or skill-based balancing is calculated.
            </p>
          </div>
        </div>
      </div>

      {bootstrap.isLoading && (
        <p className="text-sm text-muted-foreground">Loading nights…</p>
      )}
      {bootstrap.error && (
        <p className="text-sm text-destructive">
          Failed to load: {bootstrap.error.message}
        </p>
      )}
      {nights?.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No custom nights have been recorded for this server.
          </CardContent>
        </Card>
      )}

      {nights !== undefined && nights.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav className="space-y-2" aria-label="Custom nights">
            {nights.map((night) => (
              <button
                className="w-full rounded-md border border-border p-3 text-left transition-colors hover:bg-accent disabled:bg-accent"
                disabled={night.id === selectedNightId}
                key={night.id}
                onClick={() => {
                  setRequestedNightId(night.id);
                }}
                type="button"
              >
                <span className="block font-medium">
                  {dateTime.format(new Date(night.lastActivityAt))}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {night.state === "ENDED" ? "Ended" : label(night.state)} ·
                  revision {night.revision}
                </span>
              </button>
            ))}
          </nav>

          <HistoryDetailPanel
            data={selectedDetail}
            errorMessage={detail.error?.message}
            isLoading={detail.isLoading}
          />
        </div>
      )}
    </main>
  );
}
