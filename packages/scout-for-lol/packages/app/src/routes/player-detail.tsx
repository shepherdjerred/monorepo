import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

function formatDate(value: Date | string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString();
}

function channelLabel(
  channels: { id: string; name: string }[] | undefined,
  channelId: string,
): string {
  const channel = channels?.find((candidate) => candidate.id === channelId);
  return channel === undefined ? channelId : `#${channel.name}`;
}

function isActiveCompetition(competition: {
  isCancelled: boolean;
  endDate: Date | string | null;
}): boolean {
  if (competition.isCancelled) return false;
  if (competition.endDate === null) return true;
  return new Date(competition.endDate).getTime() >= Date.now();
}

export function PlayerDetail() {
  const { guildId, alias } = useParams();
  const trpc = useTRPC();
  const safeGuildId = guildId ?? "";
  const safeAlias = alias ?? "";
  const playerQuery = useQuery(
    trpc.player.getPlayer.queryOptions(
      { guildId: safeGuildId, alias: safeAlias },
      { enabled: guildId !== undefined && alias !== undefined },
    ),
  );
  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );

  if (guildId === undefined || alias === undefined) {
    return (
      <p className="text-sm text-destructive">Missing player route data</p>
    );
  }

  const player = playerQuery.data;
  const competitions = player?.competitions ?? [];
  const activeCompetitions = competitions.filter((participant) =>
    isActiveCompetition(participant.competition),
  );
  const pastCompetitions = competitions.filter(
    (participant) => !isActiveCompetition(participant.competition),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{safeAlias}</h2>
          {player && (
            <p className="text-sm text-muted-foreground">
              Updated {formatDate(player.updatedTime)}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/g/${guildId}/players`}>Players</Link>
          </Button>
          <Button asChild size="sm">
            <Link to={`/g/${guildId}/admin`}>Admin</Link>
          </Button>
        </div>
      </div>

      {playerQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading player...</p>
      )}
      {playerQuery.error && (
        <p className="text-sm text-destructive">
          Failed to load: {playerQuery.error.message}
        </p>
      )}

      {player && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Discord</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Linked user</span>
                  <p className="font-mono text-xs">{player.discordId ?? "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Created by</span>
                  <p className="font-mono text-xs">{player.creatorDiscordId}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Player ID</span>
                  <p>{player.id}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <p>{formatDate(player.createdTime)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Counts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{player.accounts.length} accounts</p>
                <p>{player.subscriptions.length} subscriptions</p>
                <p>{competitions.length} competitions</p>
              </CardContent>
            </Card>
          </div>

          <Section title="Riot accounts">
            {player.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No accounts.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Alias</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>PUUID</TableHead>
                    <TableHead>Last match</TableHead>
                    <TableHead>Last checked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {player.accounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">
                        {account.alias}
                      </TableCell>
                      <TableCell>{account.region}</TableCell>
                      <TableCell className="max-w-72 truncate font-mono text-xs text-muted-foreground">
                        {account.puuid}
                      </TableCell>
                      <TableCell>{formatDate(account.lastMatchTime)}</TableCell>
                      <TableCell>{formatDate(account.lastCheckedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <Section title="Subscriptions">
            {player.subscriptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subscriptions.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Created by</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {player.subscriptions.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell>
                        {channelLabel(
                          channelsQuery.data,
                          subscription.channelId,
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {subscription.creatorDiscordId}
                      </TableCell>
                      <TableCell>
                        {formatDate(subscription.createdTime)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          <CompetitionSection
            title="Active competitions"
            rows={activeCompetitions}
          />
          <CompetitionSection
            title="Past competitions"
            rows={pastCompetitions}
          />
        </>
      )}
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold">{props.title}</h3>
      <div className="rounded-md border border-border">{props.children}</div>
    </section>
  );
}

function CompetitionSection(props: {
  title: string;
  rows: {
    id: number;
    status: string;
    invitedBy: string | null;
    invitedAt: Date | string | null;
    joinedAt: Date | string | null;
    leftAt: Date | string | null;
    competition: {
      id: number;
      title: string;
      visibility: string;
      isCancelled: boolean;
      startDate: Date | string | null;
      endDate: Date | string | null;
    };
  }[];
}) {
  return (
    <Section title={props.title}>
      {props.rows.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">None.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Competition</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Invite</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.map((participant) => (
              <TableRow key={participant.id}>
                <TableCell className="font-medium">
                  {participant.competition.title}
                  {participant.competition.isCancelled ? " (cancelled)" : ""}
                </TableCell>
                <TableCell>{participant.status}</TableCell>
                <TableCell>{participant.competition.visibility}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(participant.competition.startDate)} to{" "}
                  {formatDate(participant.competition.endDate)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {participant.invitedBy ?? "—"} /{" "}
                  {formatDate(participant.invitedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
