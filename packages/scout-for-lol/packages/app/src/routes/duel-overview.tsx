import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { DirectDuelForm } from "#src/components/direct-duel-form.tsx";
import { DuelEventCreateForm } from "#src/components/duel-event-create-form.tsx";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { useDuelGuildParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

function competitorLabel(competitor: {
  teamName: string | null;
  accounts: readonly { playerAlias: string }[];
}) {
  return (
    competitor.teamName ??
    competitor.accounts.map((account) => account.playerAlias).join(" + ")
  );
}

export function DuelOverview() {
  const { guildId } = useDuelGuildParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { perms } = usePermissions(guildId);
  const duels = useQuery(trpc.duel.list.queryOptions({ guildId }));
  const accounts = useQuery(
    trpc.duel.eligibleAccounts.queryOptions({ guildId }),
  );
  const channels = useQuery(trpc.guild.listChannels.queryOptions({ guildId }));
  const individual = useQuery(
    trpc.duel.rollingRecords.queryOptions({ guildId, scope: "individual" }),
  );

  if (duels.isPending) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-scout-subtle">
        Loading duels…
      </div>
    );
  }
  if (duels.isError) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-scout-danger">
        {duels.error.message}
      </div>
    );
  }
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.duel.list.queryKey({ guildId }),
    });
  };
  const creationReady =
    accounts.data !== undefined && channels.data !== undefined;
  const creationError = accounts.error?.message ?? channels.error?.message;
  const canCreateEvent = perms.can("competitions", "create");
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:py-12">
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">Guild competition</p>
        <h1 className="text-3xl font-semibold tracking-tight">Duels</h1>
        <p className="max-w-2xl text-scout-subtle">
          Friendly 1v1 and 2v2 competition. No entry fees, prizes, wagers, Elo,
          or automatic no-show wins.
        </p>
      </header>
      {creationReady ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Direct challenge</CardTitle>
              <CardDescription>
                Every participant must accept the custom-match disclosure before
                results become member-visible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DirectDuelForm
                guildId={guildId}
                accounts={accounts.data}
                channels={channels.data}
                onCreated={(seriesId) => {
                  refresh();
                  void navigate(`/duels/${guildId}/series/${seriesId}`);
                }}
              />
            </CardContent>
          </Card>
          {canCreateEvent ? (
            <Card>
              <CardHeader>
                <CardTitle>Structured event</CardTitle>
                <CardDescription>
                  Asynchronous single elimination, double elimination, or round
                  robin.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DuelEventCreateForm
                  guildId={guildId}
                  channels={channels.data}
                  onCreated={(eventId) => {
                    refresh();
                    void navigate(`/duels/${guildId}/events/${eventId}`);
                  }}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Create a duel</CardTitle>
            <CardDescription>
              {accounts.isPending || channels.isPending
                ? "Loading creation controls…"
                : (creationError ??
                  "You can view guild duels, but your access does not include the creation controls.")}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Direct series</h2>
        <ul className="grid gap-2 md:grid-cols-2">
          {duels.data.direct.map((series) => (
            <li key={series.id}>
              <Link
                className="block rounded-md border p-4 hover:bg-scout-hover"
                to={`/duels/${guildId}/series/${series.id}`}
              >
                <span className="flex justify-between gap-2">
                  <strong>
                    {competitorLabel(series.competitorOne)} vs{" "}
                    {competitorLabel(series.competitorTwo)}
                  </strong>
                  <Badge variant="outline">
                    {series.state.replaceAll("_", " ")}
                  </Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {duels.data.direct.length === 0 ? (
          <p className="text-sm text-scout-subtle">No direct challenges yet.</p>
        ) : null}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Events</h2>
        <ul className="grid gap-2 md:grid-cols-2">
          {duels.data.events.map((event) => (
            <li key={event.id}>
              <Link
                className="block rounded-md border p-4 hover:bg-scout-hover"
                to={`/duels/${guildId}/events/${event.id}`}
              >
                <span className="flex justify-between gap-2">
                  <strong>{event.name}</strong>
                  <Badge variant="outline">
                    {event.state.replaceAll("_", " ")}
                  </Badge>
                </span>
                <span className="mt-2 block text-sm text-scout-subtle">
                  {event.format.replaceAll("_", " ")} ·{" "}
                  {event.entrants.toString()} entrants
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {duels.data.events.length === 0 ? (
          <p className="text-sm text-scout-subtle">No events yet.</p>
        ) : null}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Rolling 1v1 records</h2>
          <Button asChild size="sm" variant="outline">
            <Link to={`/duels/${guildId}/head-to-head`}>Head to head</Link>
          </Button>
        </div>
        {individual.isPending ? (
          <p className="text-sm text-scout-subtle">Loading records…</p>
        ) : (
          <ol className="space-y-2">
            {individual.data?.map((record) => (
              <li
                className="flex items-center justify-between rounded-md border p-3 text-sm"
                key={record.subjectKey}
              >
                <span>{record.label}</span>
                <span>
                  {record.wins.toString()}–{record.losses.toString()} ·{" "}
                  {record.placed && record.winRate !== null
                    ? `${Math.round(record.winRate * 100).toString()}%`
                    : "unplaced"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
