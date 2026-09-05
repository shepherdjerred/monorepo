import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  Bell,
  Check,
  ChevronsUpDown,
  Coins,
  Compass,
  FileBarChart,
  KeyRound,
  Server,
  Settings,
  ShieldCheck,
  SquarePen,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import type { ExploreConversation } from "@scout-for-lol/data";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@scout-for-lol/design-system/components/dropdown-menu";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import {
  consumerNavigationItems,
  guildIdFromAppPath,
  guildWorkspacePath,
  isExplorePath,
  visibleGuildNavigationItems,
} from "#src/lib/app-navigation.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/api/stale-times.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { ExploreSidebar } from "#src/components/explore/explore-sidebar.tsx";
import { useOptionalExploreRuns } from "#src/components/explore/explore-runs-context.ts";
import { RenameConversationDialog } from "#src/components/dialogs/rename-conversation-dialog.tsx";
import { ConfirmDeleteDialog } from "#src/components/dialogs/confirm-delete-dialog.tsx";
import { analyticsMeta } from "#src/lib/analytics.ts";

function getActiveConversationId(pathname: string): string | null {
  const match = /^\/(?:app\/)?explore\/([^/]+)/.exec(pathname);
  if (!match) return null;
  if (match[1] === "s") return null;
  return match[1] ?? null;
}

function ExploreNavigationSection(props: { activeId: string | null }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runs = useOptionalExploreRuns();
  const [renaming, setRenaming] = useState<ExploreConversation | null>(null);
  const [deleting, setDeleting] = useState<ExploreConversation | null>(null);

  const conversationsQuery = useQuery({
    ...trpc.explore.list.queryOptions(),
    staleTime: 60_000,
  });

  const renameMutation = useMutation(
    trpc.explore.rename.mutationOptions({
      meta: analyticsMeta("explore_conversation_renamed"),
    }),
  );
  const deleteMutation = useMutation(
    trpc.explore.delete.mutationOptions({
      meta: analyticsMeta("explore_conversation_deleted"),
    }),
  );

  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleSelect = (id: string) => {
    void navigate(`/explore/${id}`);
  };

  const handleNew = () => {
    void navigate("/explore");
  };

  const handleStartRename = (conversation: ExploreConversation) => {
    setRenameError(null);
    setRenaming(conversation);
  };

  const handleStartDelete = (conversation: ExploreConversation) => {
    setDeleteError(null);
    setDeleting(conversation);
  };

  const handleRename = (
    conversation: ExploreConversation,
    nextTitle: string,
  ) => {
    setRenameError(null);
    renameMutation.mutate(
      {
        conversationId: conversation.id,
        title: nextTitle,
      },
      {
        onSuccess: () => {
          setRenaming(null);
          void Promise.all([
            queryClient.invalidateQueries({
              queryKey: trpc.explore.list.queryKey(),
            }),
            queryClient.invalidateQueries({
              queryKey: trpc.explore.get.queryKey({
                conversationId: conversation.id,
              }),
            }),
          ]);
        },
        onError: (err: unknown) => {
          setRenameError(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const handleDelete = (conversation: ExploreConversation) => {
    setDeleteError(null);
    deleteMutation.mutate(
      { conversationId: conversation.id },
      {
        onSuccess: () => {
          setDeleting(null);
          queryClient.removeQueries({
            queryKey: trpc.explore.get.queryKey({
              conversationId: conversation.id,
            }),
          });
          void queryClient.invalidateQueries({
            queryKey: trpc.explore.list.queryKey(),
          });
          if (props.activeId === conversation.id) {
            void navigate("/explore", { replace: true });
          }
        },
        onError: (err: unknown) => {
          setDeleteError(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const statusForConversation = runs?.status ?? (() => null);

  return (
    <>
      <ExploreSidebar
        conversations={conversationsQuery.data ?? []}
        activeId={props.activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onRename={handleStartRename}
        onDelete={handleStartDelete}
        statusForConversation={statusForConversation}
        showNewButton={false}
      />

      <RenameConversationDialog
        conversation={renaming}
        pending={renameMutation.isPending}
        error={renameError}
        onClose={() => {
          setRenaming(null);
          setRenameError(null);
        }}
        onRename={(conversation, nextTitle) => {
          handleRename(conversation, nextTitle);
        }}
      />

      <ConfirmDeleteDialog
        conversation={deleting}
        pending={deleteMutation.isPending}
        error={deleteError}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={(conversation) => {
          handleDelete(conversation);
        }}
      />
    </>
  );
}

function guildNavIcon(to: string) {
  switch (to) {
    case "customs":
      return Swords;
    case "subscriptions":
      return Bell;
    case "players":
      return Users;
    case "competitions":
      return Trophy;
    case "reports":
      return FileBarChart;
    case "audit":
      return ShieldCheck;
    case "access":
      return KeyRound;
    default:
      return Settings;
  }
}

export function AppNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const trpc = useTRPC();
  const guildId = guildIdFromAppPath(location.pathname);
  const guildsQuery = useQuery(
    trpc.guild.listManageable.queryOptions(undefined, {
      staleTime: STALE_TIME_SLOW_LIST,
    }),
  );
  const exploreQuery = useQuery(trpc.explore.status.queryOptions());
  const profilesQuery = useQuery(
    trpc.consumerPlayer.status.queryOptions(undefined, { retry: 2 }),
  );
  const bucksQuery = useQuery(
    trpc.bucks.status.queryOptions(undefined, { retry: 2 }),
  );
  const { perms } = usePermissions(guildId);

  const tools = consumerNavigationItems({
    exploreAvailable: exploreQuery.data?.enabled === true,
    profilesAvailable: profilesQuery.data?.state === "available",
    bucksAvailable: bucksQuery.data?.state === "available",
  });
  const selectedGuild = guildsQuery.data?.find((guild) => guild.id === guildId);
  const guildItems = visibleGuildNavigationItems(
    (permission) => perms.can(permission.resource, permission.action),
    selectedGuild?.customNightsEnabled === true,
  );

  const activeConversationId = getActiveConversationId(location.pathname);
  const exploreAvailable = exploreQuery.data?.enabled === true;
  const inExplore = isExplorePath(location.pathname);

  return (
    <nav className="scout-app-sidebar-nav" aria-label="App navigation">
      {tools.length === 0 ? null : (
        <section className="space-y-0.5 shrink-0" aria-label="Tools">
          <p className="scout-app-sidebar-heading">Tools</p>
          {tools.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/explore"}
              className="scout-app-sidebar-link flex items-center gap-2.5 px-2.5 py-2 text-sm"
            >
              {item.to === "/explore" && (
                <Compass className="size-4 shrink-0 text-scout-subtle" />
              )}
              {item.to === "/players" && (
                <Users className="size-4 shrink-0 text-scout-subtle" />
              )}
              {item.to === "/bucks" && (
                <Coins className="size-4 shrink-0 text-scout-subtle" />
              )}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </section>
      )}

      {inExplore && exploreAvailable && (
        <section
          className="min-h-0 flex-1 flex flex-col overflow-hidden border-t border-scout-border/60 pt-2.5"
          aria-label="Recent chats"
        >
          <div className="flex items-center justify-between px-2.5 pb-1 shrink-0">
            <p className="scout-app-sidebar-heading !p-0 !m-0">Chats</p>
            <button
              type="button"
              title="New chat"
              aria-label="New chat"
              className="flex size-6 items-center justify-center rounded text-scout-subtle transition-colors hover:bg-scout-hover hover:text-scout-ink"
              onClick={() => {
                void navigate("/explore");
              }}
            >
              <SquarePen className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ExploreNavigationSection activeId={activeConversationId} />
          </div>
        </section>
      )}

      {guildId !== undefined && guildItems.length > 0 && (
        <section
          className="min-h-0 flex-1 flex flex-col overflow-hidden border-t border-scout-border/60 pt-2.5"
          aria-label="Server management"
        >
          <p className="scout-app-sidebar-heading truncate">
            {selectedGuild?.name ?? "Server"}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto space-y-0.5">
            {guildItems.map((item) => {
              const Icon = guildNavIcon(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={`/g/${guildId}/${item.to}`}
                  className="scout-app-sidebar-link flex items-center gap-2.5 px-2.5 py-2 text-sm"
                >
                  <Icon className="size-4 shrink-0 text-scout-subtle" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </section>
      )}

      <section
        className="scout-app-sidebar-section mt-auto shrink-0 border-t border-scout-border/60 pt-2 space-y-0.5"
        aria-label="Workspace"
      >
        <NavLink
          to="/manage"
          end
          className="scout-app-sidebar-link flex items-center gap-2.5 px-2.5 py-2 text-sm"
        >
          <Settings className="size-4 shrink-0 text-scout-subtle" />
          <span>Manage servers</span>
        </NavLink>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-scout-ink transition-colors hover:bg-scout-hover"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-scout-border/60 bg-scout-canvas text-xs font-semibold text-scout-ink">
                  {selectedGuild ? (
                    selectedGuild.name.slice(0, 2).toUpperCase()
                  ) : (
                    <Server className="size-3.5 text-scout-subtle" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight text-scout-ink">
                    {selectedGuild ? selectedGuild.name : "Switch server"}
                  </p>
                  <p className="truncate text-xs leading-tight text-scout-subtle">
                    {selectedGuild ? "Active server" : "No server selected"}
                  </p>
                </div>
              </div>
              <ChevronsUpDown className="size-4 shrink-0 text-scout-subtle transition-colors group-hover:text-scout-ink" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Servers</DropdownMenuLabel>
            {guildsQuery.data?.map((guild) => (
              <DropdownMenuItem
                key={guild.id}
                onClick={() => {
                  void navigate(guildWorkspacePath(guild.id));
                }}
                className={`flex items-center justify-between gap-2 text-sm ${
                  guild.id === guildId
                    ? "bg-scout-hover/70 font-semibold text-scout-ink"
                    : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded border border-scout-border/60 bg-scout-canvas text-xs font-semibold text-scout-ink">
                    {guild.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="truncate">{guild.name}</span>
                </div>
                {guild.id === guildId && (
                  <Check className="ml-1 size-4 shrink-0 text-scout-primary" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </section>
    </nav>
  );
}
