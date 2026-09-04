import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { DuelEventRegistrationForms } from "#src/components/duel-event-registration-forms.tsx";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { useDuelEventParams } from "#src/lib/route-params.ts";
import { useTRPC, type RouterOutputs } from "#src/lib/trpc.ts";

type DuelEventOutput = RouterOutputs["duel"]["event"];
type DuelStandingsOutput = RouterOutputs["duel"]["standings"];

function entrantName(competitor: {
  teamName: string | null;
  accounts: readonly { playerAlias: string }[];
}) {
  return (
    competitor.teamName ??
    competitor.accounts.map((account) => account.playerAlias).join(" + ")
  );
}

function PendingInvitations(props: {
  entrants: DuelEventOutput["entrants"];
  ownPlayerIds: ReadonlySet<number>;
  onAcceptDisclosure: (playerId: number) => void;
  onAcceptRegistration: (competitorId: string) => void;
}) {
  if (props.entrants.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accept invitation</CardTitle>
        <CardDescription>
          Accept the versioned custom-match disclosure for each of your players,
          then accept the event registration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {[...props.ownPlayerIds].map((playerId) => (
          <Button
            key={playerId}
            type="button"
            variant="outline"
            onClick={() => {
              props.onAcceptDisclosure(playerId);
            }}
          >
            Accept disclosure for player {playerId.toString()}
          </Button>
        ))}
        {props.entrants.map((entrant) => (
          <Button
            key={entrant.competitor.id}
            type="button"
            onClick={() => {
              props.onAcceptRegistration(entrant.competitor.id);
            }}
          >
            Accept {entrantName(entrant.competitor)}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function EventEntrants(props: {
  event: Pick<DuelEventOutput, "entrants" | "seedMethod" | "state">;
  canStart: boolean;
  startPending: boolean;
  onStart: (manualOrder: string[] | undefined) => void;
}) {
  const accepted = props.event.entrants.filter(
    (entrant) => entrant.state === "accepted",
  );
  const manualOrder =
    props.event.seedMethod === "manual"
      ? accepted.map((entrant) => entrant.competitor.id)
      : undefined;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Entrants</h2>
        {props.canStart && props.event.state === "registration_open" ? (
          <Button
            type="button"
            disabled={props.startPending || accepted.length < 2}
            onClick={() => {
              props.onStart(manualOrder);
            }}
          >
            Start event
          </Button>
        ) : null}
      </div>
      <ol className="grid gap-2 md:grid-cols-2">
        {props.event.entrants.map((entrant) => (
          <li className="rounded-md border p-3" key={entrant.competitor.id}>
            <span className="font-medium">
              {entrant.seed === null ? "—" : `#${entrant.seed.toString()}`}{" "}
              {entrantName(entrant.competitor)}
            </span>
            <Badge className="ml-2" variant="outline">
              {entrant.state}
            </Badge>
          </li>
        ))}
      </ol>
    </section>
  );
}

function entrantNameForStanding(
  event: DuelEventOutput,
  competitorId: string,
): string {
  const entrant = event.entrants.find(
    (candidate) => candidate.competitor.id === competitorId,
  );
  if (entrant === undefined) {
    throw new Error("Duel standing references an unknown event entrant");
  }
  return entrantName(entrant.competitor);
}

function EventStandings(props: {
  event: DuelEventOutput;
  standings: DuelStandingsOutput | undefined;
}) {
  if (props.standings === undefined) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">Standings</h2>
      <ol className="space-y-2">
        {props.standings.standings
          .toSorted((left, right) => right.wins - left.wins)
          .map((standing) => (
            <li
              className="flex justify-between rounded-md border p-3 text-sm"
              key={standing.competitorId}
            >
              <span>
                {entrantNameForStanding(props.event, standing.competitorId)}
              </span>
              <span>
                {standing.wins.toString()}–{standing.losses.toString()}
              </span>
            </li>
          ))}
      </ol>
    </section>
  );
}

export function DuelEvent() {
  const { guildId, eventId } = useDuelEventParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { perms } = usePermissions(guildId);
  const [actionError, setActionError] = useState<string | null>(null);
  const event = useQuery(
    trpc.duel.event.queryOptions(
      { guildId, eventId },
      { refetchInterval: 5000 },
    ),
  );
  const linked = useQuery(trpc.duel.linkedAccounts.queryOptions({ guildId }));
  const canInvite =
    event.data?.isOrganizer === true && perms.can("competitions", "invite");
  const canStart =
    event.data?.isOrganizer === true && perms.can("competitions", "update");
  const eligible = useQuery(
    trpc.duel.eligibleAccounts.queryOptions(
      { guildId },
      { enabled: canInvite },
    ),
  );
  const standings = useQuery(
    trpc.duel.standings.queryOptions({ guildId, eventId }, { retry: false }),
  );
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.duel.event.queryKey({ guildId, eventId }),
    });
  };
  const register = useMutation(
    trpc.duel.register.mutationOptions({
      onSuccess: invalidate,
      onError: (error) => {
        setActionError(error.message);
      },
    }),
  );
  const invite = useMutation(
    trpc.duel.invite.mutationOptions({
      onSuccess: invalidate,
      onError: (error) => {
        setActionError(error.message);
      },
    }),
  );
  const acceptDisclosure = useMutation(
    trpc.duel.acceptDisclosure.mutationOptions({
      onSuccess: invalidate,
      onError: (error) => {
        setActionError(error.message);
      },
    }),
  );
  const acceptRegistration = useMutation(
    trpc.duel.acceptRegistration.mutationOptions({
      onSuccess: invalidate,
      onError: (error) => {
        setActionError(error.message);
      },
    }),
  );
  const start = useMutation(
    trpc.duel.startEvent.mutationOptions({
      onSuccess: invalidate,
      onError: (error) => {
        setActionError(error.message);
      },
    }),
  );

  if (event.isPending || linked.isPending || (canInvite && eligible.isPending))
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-scout-subtle">
        Loading event…
      </div>
    );
  if (event.isError || linked.isError || (canInvite && eligible.isError))
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-scout-danger">
        {event.error?.message ??
          linked.error?.message ??
          eligible.error?.message}
      </div>
    );
  const ownPlayerIds = new Set<number>(
    linked.data.map((account) => account.playerId),
  );
  const pendingOwnEntrants = event.data.entrants.filter(
    (entrant) =>
      entrant.state === "pending" &&
      entrant.competitor.accounts.some((account) =>
        ownPlayerIds.has(account.playerId),
      ),
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:py-12">
      <Link
        className="text-sm text-scout-subtle hover:underline"
        to={`/duels/${guildId}`}
      >
        ← Duels
      </Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {event.data.name}
          </h1>
          <Badge variant="outline">
            {event.data.state.replaceAll("_", " ")}
          </Badge>
        </div>
        <p className="text-scout-subtle">
          {event.data.format.replaceAll("_", " ")} ·{" "}
          {event.data.competitorKind === "player" ? "1v1" : "2v2"} · best of{" "}
          {event.data.bestOf.toString()}
        </p>
      </header>
      {actionError === null ? null : (
        <p role="alert" className="text-sm text-scout-danger">
          {actionError}
        </p>
      )}
      <DuelEventRegistrationForms
        registrationOpen={event.data.state === "registration_open"}
        registrationMode={event.data.registrationMode}
        competitorKind={event.data.competitorKind}
        linkedAccounts={linked.data}
        eligibleAccounts={eligible.data}
        canInvite={canInvite}
        registerPending={register.isPending}
        invitePending={invite.isPending}
        onRegister={(selection) => {
          setActionError(null);
          register.mutate({ guildId, eventId, selection });
        }}
        onInvite={(selection) => {
          setActionError(null);
          invite.mutate({ guildId, eventId, selection });
        }}
      />
      <PendingInvitations
        entrants={pendingOwnEntrants}
        ownPlayerIds={ownPlayerIds}
        onAcceptDisclosure={(playerId) => {
          acceptDisclosure.mutate({ guildId, playerId });
        }}
        onAcceptRegistration={(competitorId) => {
          acceptRegistration.mutate({ guildId, eventId, competitorId });
        }}
      />
      <EventEntrants
        event={event.data}
        canStart={canStart}
        startPending={start.isPending}
        onStart={(manualOrder) => {
          setActionError(null);
          start.mutate({
            guildId,
            eventId,
            ...(manualOrder === undefined ? {} : { manualOrder }),
          });
        }}
      />
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Series</h2>
          <Button asChild size="sm" variant="outline">
            <Link to={`/duels/${guildId}/events/${eventId}/standings`}>
              Full standings
            </Link>
          </Button>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {event.data.series.map((series) => (
            <Link
              className="rounded-md border p-3 hover:bg-scout-hover"
              key={series.id}
              to={`/duels/${guildId}/series/${series.id}`}
            >
              <span className="font-medium">
                {entrantName(series.competitorOne)} vs{" "}
                {entrantName(series.competitorTwo)}
              </span>
              <span className="mt-1 block text-sm text-scout-subtle">
                Round {series.roundNumber?.toString() ?? "—"} ·{" "}
                {series.state.replaceAll("_", " ")} ·{" "}
                {series.gameWins.first.toString()}–
                {series.gameWins.second.toString()}
              </span>
            </Link>
          ))}
        </div>
      </section>
      <EventStandings event={event.data} standings={standings.data} />
    </div>
  );
}
