import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { findRegion } from "#src/lib/regions.ts";
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
import { DiscordUser } from "#src/components/discord-user.tsx";
import {
  CompetitionSection,
  PlayerAccountsTable,
  Section,
} from "#src/components/player-detail-sections.tsx";
import { RenamePlayerDialog } from "#src/components/rename-player-dialog.tsx";
import { LinkDiscordDialog } from "#src/components/link-discord-dialog.tsx";
import { AddAccountDialog } from "#src/components/add-account-dialog.tsx";
import { EditAccountDialog } from "#src/components/edit-account-dialog.tsx";

type EditableAccount = { id: number; alias: string; region: string };

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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const safeGuildId = guildId ?? "";
  const safeAlias = alias ?? "";
  const [renameOpen, setRenameOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<EditableAccount | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const playerKey = trpc.player.getPlayer.queryKey({
    guildId: safeGuildId,
    alias: safeAlias,
  });
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

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: playerKey });
  }

  const unlinkMutation = useMutation(
    trpc.player.unlinkDiscord.mutationOptions({
      onSuccess: () => {
        setActionError(null);
        refresh();
      },
      onError: (err) => {
        setActionError(err.message);
      },
    }),
  );
  const deleteAccountMutation = useMutation(
    trpc.player.deleteAccount.mutationOptions({
      onSuccess: () => {
        setActionError(null);
        refresh();
      },
      onError: (err) => {
        setActionError(err.message);
      },
    }),
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
          {player && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setRenameOpen(true);
              }}
            >
              Rename
            </Button>
          )}
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
      {actionError !== null && (
        <p className="text-sm text-destructive">{actionError}</p>
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
                  <p>
                    <DiscordUser
                      id={player.discordId}
                      name={player.discordUser}
                    />
                  </p>
                  <div className="pt-1">
                    {player.discordId === null ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setLinkOpen(true);
                        }}
                      >
                        Link Discord
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={unlinkMutation.isPending}
                        onClick={() => {
                          if (
                            !globalThis.confirm(
                              `Unlink Discord from "${safeAlias}"?`,
                            )
                          ) {
                            return;
                          }
                          unlinkMutation.mutate({
                            guildId,
                            playerAlias: safeAlias,
                          });
                        }}
                      >
                        Unlink
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Created by</span>
                  <p>
                    <DiscordUser
                      id={player.creatorDiscordId}
                      name={player.creatorDiscordUser}
                    />
                  </p>
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

          <Section
            title="Riot accounts"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setAddAccountOpen(true);
                }}
              >
                + Add account
              </Button>
            }
          >
            <PlayerAccountsTable
              accounts={player.accounts}
              deletePending={deleteAccountMutation.isPending}
              onEdit={(account) => {
                setEditAccount({
                  id: account.id,
                  alias: account.alias,
                  region: account.region,
                });
              }}
              onDelete={(account) => {
                if (account.riotGameName === null) return;
                const region = findRegion(account.region);
                if (region === null) {
                  setActionError(
                    `Unknown region "${account.region}" — delete from the Admin page.`,
                  );
                  return;
                }
                const riotId = `${account.riotGameName}#${account.riotTagLine ?? ""}`;
                if (
                  !globalThis.confirm(
                    `Delete account ${riotId} from "${safeAlias}"?`,
                  )
                ) {
                  return;
                }
                deleteAccountMutation.mutate({ guildId, riotId, region });
              }}
            />
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
                      <TableCell>
                        <DiscordUser
                          id={subscription.creatorDiscordId}
                          name={subscription.creatorDiscordUser}
                        />
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

          <RenamePlayerDialog
            guildId={guildId}
            currentAlias={safeAlias}
            open={renameOpen}
            onOpenChange={setRenameOpen}
            onRenamed={(newAlias) => {
              setRenameOpen(false);
              void navigate(
                `/g/${guildId}/players/${encodeURIComponent(newAlias)}`,
              );
            }}
          />
          <LinkDiscordDialog
            guildId={guildId}
            playerAlias={safeAlias}
            open={linkOpen}
            onOpenChange={setLinkOpen}
            onLinked={() => {
              setLinkOpen(false);
              refresh();
            }}
          />
          <AddAccountDialog
            guildId={guildId}
            playerAlias={safeAlias}
            open={addAccountOpen}
            onOpenChange={setAddAccountOpen}
            onAdded={() => {
              setAddAccountOpen(false);
              refresh();
            }}
          />
          {editAccount !== null && (
            <EditAccountDialog
              guildId={guildId}
              account={editAccount}
              open
              onOpenChange={(open) => {
                if (!open) setEditAccount(null);
              }}
              onSaved={() => {
                setEditAccount(null);
                refresh();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
