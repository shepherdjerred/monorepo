import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { PlayerSubscriptionsManager } from "#src/components/player-subscriptions-manager.tsx";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { CompetitionStatusSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { nextRiotIdPollInterval } from "#src/lib/riot-id-poll.ts";
import { findRegion, type RegionValue } from "#src/lib/regions.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { usePlayerParams } from "#src/lib/route-params.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import { DiscordUser } from "#src/components/discord-user.tsx";
import { PlayerHeaderActions } from "#src/components/player-header-actions.tsx";
import {
  CompetitionSection,
  PlayerAccountsTable,
  Section,
} from "#src/components/player-detail-sections.tsx";
import { RenamePlayerDialog } from "#src/components/rename-player-dialog.tsx";
import { LinkDiscordDialog } from "#src/components/link-discord-dialog.tsx";
import { AddAccountDialog } from "#src/components/add-account-dialog.tsx";
import { EditAccountDialog } from "#src/components/edit-account-dialog.tsx";
import { MergePlayersDialog } from "#src/components/merge-players-dialog.tsx";
import { TransferAccountDialog } from "#src/components/transfer-account-dialog.tsx";

type EditableAccount = { id: number; alias: string; region: string };

type TransferableAccount = { riotId: string; region: RegionValue };

function formatDate(value: Date | string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString();
}

function isActiveCompetition(competition: { status: string }): boolean {
  // Parse (throw) on an unknown status rather than treating it as active.
  const status = CompetitionStatusSchema.parse(competition.status);
  return status !== "ENDED" && status !== "CANCELLED";
}

function Allowed(props: { when: boolean; children: ReactNode }) {
  return props.when ? props.children : null;
}

type PlayerSummary = {
  id: number;
  discordId: string | null;
  discordUser: { username: string; displayName: string } | null;
  creatorDiscordId: string;
  creatorDiscordUser: { username: string; displayName: string } | null;
  createdTime: Date | string;
  accounts: unknown[];
  subscriptions: unknown[];
};

function PlayerSummaryCards(props: {
  player: PlayerSummary;
  competitionCount: number;
  canLink: boolean;
  unlinkPending: boolean;
  onLink: () => void;
  onUnlink: () => void;
}) {
  const { player } = props;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Discord</CardTitle>
          <Allowed when={props.canLink}>
            {player.discordId === null ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={props.onLink}
              >
                Link Discord
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={props.unlinkPending}
                onClick={props.onUnlink}
              >
                Unlink
              </Button>
            )}
          </Allowed>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Linked user</dt>
            <dd>
              <DiscordUser id={player.discordId} name={player.discordUser} />
            </dd>
            <dt className="text-muted-foreground">Created by</dt>
            <dd>
              <DiscordUser
                id={player.creatorDiscordId}
                name={player.creatorDiscordUser}
              />
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Player ID</dt>
            <dd>{player.id}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDate(player.createdTime)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Counts</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Accounts</dt>
            <dd>{player.accounts.length}</dd>
            <dt className="text-muted-foreground">Subscriptions</dt>
            <dd>{player.subscriptions.length}</dd>
            <dt className="text-muted-foreground">Competitions</dt>
            <dd>{props.competitionCount}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export function PlayerDetail() {
  const { guildId, alias } = usePlayerParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { perms } = usePermissions(guildId);
  const [renameOpen, setRenameOpen] = useState(false);
  // Ended/cancelled competitions are hidden by default behind the toggle.
  const [showAllCompetitions, setShowAllCompetitions] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<EditableAccount | null>(null);
  const [transferAccount, setTransferAccount] =
    useState<TransferableAccount | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const playerKey = trpc.player.getPlayer.queryKey({ guildId, alias });
  // Bounded poll for accounts whose Riot ID is still resolving (see helper).
  const unresolvedPollsRef = useRef(0);
  const playerQuery = useSuspenseQuery(
    trpc.player.getPlayer.queryOptions(
      { guildId, alias },
      {
        // Freshly added accounts start with an unresolved Riot ID (resolved
        // server-side shortly after). Poll (bounded) until every account
        // resolves so the user never has to reload by hand.
        refetchInterval: (query) =>
          nextRiotIdPollInterval(
            query.state.data?.accounts,
            unresolvedPollsRef,
          ),
      },
    ),
  );
  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions({ guildId }),
  );

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: playerKey });
    // Keep the channel-centric surfaces in sync with player-page edits.
    void queryClient.invalidateQueries({
      queryKey: trpc.subscription.list.pathKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.player.listPlayers.pathKey(),
    });
  }

  const unlinkMutation = useMutation(
    trpc.player.unlinkDiscord.mutationOptions({
      meta: analyticsMeta("player_discord_unlinked"),
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
      meta: analyticsMeta("player_account_deleted"),
      onSuccess: () => {
        setActionError(null);
        refresh();
      },
      onError: (err) => {
        setActionError(err.message);
      },
    }),
  );
  const deletePlayerMutation = useMutation(
    trpc.player.deletePlayer.mutationOptions({
      meta: analyticsMeta("player_deleted"),
      onSuccess: () => {
        // The players list carries a long staleTime; invalidate it before
        // navigating back so the just-deleted player doesn't linger in the list
        // for up to STALE_TIME_SLOW_LIST.
        void queryClient.invalidateQueries({
          queryKey: trpc.player.listPlayers.pathKey(),
        });
        void navigate(`/g/${guildId}/players`);
      },
      onError: (err) => {
        setActionError(err.message);
      },
    }),
  );

  const player = playerQuery.data;
  const competitions = player.competitions;
  const activeCompetitions = competitions.filter((participant) =>
    isActiveCompetition(participant.competition),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{alias}</h2>
          <p className="text-sm text-muted-foreground">
            Updated {formatDate(player.updatedTime)}
          </p>
        </div>
        <PlayerHeaderActions
          guildId={guildId}
          alias={alias}
          playerLoaded={true}
          permissions={perms}
          deletePending={deletePlayerMutation.isPending}
          onRename={() => {
            setRenameOpen(true);
          }}
          onMerge={() => {
            setMergeOpen(true);
          }}
          onDelete={() => {
            deletePlayerMutation.mutate({ guildId, alias });
          }}
        />
      </div>

      {actionError !== null && (
        <p className="text-sm text-destructive">{actionError}</p>
      )}

      <PlayerSummaryCards
        player={player}
        competitionCount={competitions.length}
        canLink={perms.can("players", "link")}
        unlinkPending={unlinkMutation.isPending}
        onLink={() => {
          setLinkOpen(true);
        }}
        onUnlink={() => {
          if (!globalThis.confirm(`Unlink Discord from "${alias}"?`)) {
            return;
          }
          unlinkMutation.mutate({ guildId, playerAlias: alias });
        }}
      />

      <Section
        title="Riot accounts"
        action={
          <Allowed when={perms.can("accounts", "create")}>
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
          </Allowed>
        }
      >
        <PlayerAccountsTable
          accounts={player.accounts}
          canEdit={perms.can("accounts", "update")}
          canTransfer={perms.can("accounts", "transfer")}
          canDelete={perms.can("accounts", "delete")}
          deletePending={deleteAccountMutation.isPending}
          onEdit={(account) => {
            setEditAccount({
              id: account.id,
              alias: account.alias,
              region: account.region,
            });
          }}
          onTransfer={(account) => {
            if (account.riotGameName === null) return;
            const region = findRegion(account.region);
            if (region === null) {
              setActionError(`Unknown region "${account.region}".`);
              return;
            }
            setTransferAccount({
              riotId: `${account.riotGameName}#${account.riotTagLine ?? ""}`,
              region,
            });
          }}
          onDelete={(account) => {
            if (account.riotGameName === null) return;
            const region = findRegion(account.region);
            if (region === null) {
              setActionError(`Unknown region "${account.region}".`);
              return;
            }
            const riotId = `${account.riotGameName}#${account.riotTagLine ?? ""}`;
            if (
              !globalThis.confirm(`Delete account ${riotId} from "${alias}"?`)
            ) {
              return;
            }
            deleteAccountMutation.mutate({ guildId, riotId, region });
          }}
        />
      </Section>

      <PlayerSubscriptionsManager
        guildId={guildId}
        alias={alias}
        subscriptions={player.subscriptions}
        channels={channelsQuery.data}
        perms={perms}
        refresh={refresh}
        setActionError={setActionError}
      />

      <CompetitionSection
        title="Competitions"
        guildId={guildId}
        rows={showAllCompetitions ? competitions : activeCompetitions}
        action={
          <Button
            type="button"
            size="sm"
            variant={showAllCompetitions ? "outline" : "default"}
            onClick={() => {
              setShowAllCompetitions((prev) => !prev);
            }}
          >
            {showAllCompetitions ? "All" : "Active only"}
          </Button>
        }
      />

      <Allowed when={perms.can("players", "update")}>
        <RenamePlayerDialog
          guildId={guildId}
          currentAlias={alias}
          open={renameOpen}
          onOpenChange={setRenameOpen}
          onRenamed={(newAlias) => {
            setRenameOpen(false);
            void navigate(
              `/g/${guildId}/players/${encodeURIComponent(newAlias)}`,
            );
          }}
        />
      </Allowed>
      <Allowed when={perms.can("players", "merge")}>
        <MergePlayersDialog
          guildId={guildId}
          sourceAlias={alias}
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          onMerged={(targetAlias) => {
            setMergeOpen(false);
            void navigate(
              `/g/${guildId}/players/${encodeURIComponent(targetAlias)}`,
            );
          }}
        />
      </Allowed>
      <Allowed
        when={perms.can("accounts", "transfer") && transferAccount !== null}
      >
        {transferAccount !== null && (
          <TransferAccountDialog
            guildId={guildId}
            account={transferAccount}
            open
            onOpenChange={(open) => {
              if (!open) setTransferAccount(null);
            }}
            onTransferred={(toPlayerAlias) => {
              setTransferAccount(null);
              void navigate(
                `/g/${guildId}/players/${encodeURIComponent(toPlayerAlias)}`,
              );
            }}
          />
        )}
      </Allowed>
      <Allowed when={perms.can("players", "link")}>
        <LinkDiscordDialog
          guildId={guildId}
          playerAlias={alias}
          open={linkOpen}
          onOpenChange={setLinkOpen}
          onLinked={() => {
            setLinkOpen(false);
            refresh();
          }}
        />
      </Allowed>
      <Allowed when={perms.can("accounts", "create")}>
        <AddAccountDialog
          guildId={guildId}
          playerAlias={alias}
          open={addAccountOpen}
          onOpenChange={setAddAccountOpen}
          onAdded={() => {
            setAddAccountOpen(false);
            refresh();
          }}
        />
      </Allowed>
      <Allowed when={perms.can("accounts", "update") && editAccount !== null}>
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
      </Allowed>
    </div>
  );
}
