import { useQuery } from "@tanstack/react-query";
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
  Target,
  Trophy,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@scout-for-lol/design-system/components/overlays/dropdown-menu";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import {
  type GuildNavigationItem,
  consumerNavigationItems,
  guildIdFromAppPath,
  guildWorkspacePath,
  isExplorePath,
  resolveHallTo,
  visibleGuildNavigationItems,
} from "#src/lib/routes/app-navigation.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/query/stale-times.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { ExploreNavigationSection } from "#src/components/explore/explore-navigation-section.tsx";

function getActiveConversationId(pathname: string): string | null {
  const match = /^\/(?:app\/)?explore\/([^/]+)/.exec(pathname);
  if (!match) return null;
  if (match[1] === "s") return null;
  return match[1] ?? null;
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
    case "hall-of-fame":
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

function ToolNavIcon(props: { to: string }) {
  if (props.to === "/explore") {
    return <Compass className="size-4 shrink-0 text-scout-subtle" />;
  }
  if (props.to === "/players") {
    return <Users className="size-4 shrink-0 text-scout-subtle" />;
  }
  if (props.to === "/challenges") {
    return <Target className="size-3.5 shrink-0 text-scout-subtle" />;
  }
  if (props.to === "/bucks") {
    return <Coins className="size-4 shrink-0 text-scout-subtle" />;
  }
  if (props.to.startsWith("/halls")) {
    return <Trophy className="size-4 shrink-0 text-scout-subtle" />;
  }
  return null;
}

function ToolsNavigationSection(props: {
  tools: readonly { label: string; to: string }[];
  inHalls: boolean;
  hallGuilds: readonly { id: string; name: string }[];
}) {
  if (props.tools.length === 0) return null;

  return (
    <section className="space-y-0.5 shrink-0" aria-label="Tools">
      <p className="scout-app-sidebar-heading">Tools</p>
      {props.tools.map((item) => {
        const isHallItem = item.to.startsWith("/halls");
        return (
          <div key={item.to} className="space-y-0.5">
            <NavLink
              to={item.to}
              end={item.to === "/explore"}
              className="scout-app-sidebar-link flex items-center gap-2.5 px-2.5 py-2 text-sm"
            >
              <ToolNavIcon to={item.to} />
              <span>{item.label}</span>
            </NavLink>

            {isHallItem && props.inHalls && props.hallGuilds.length > 1 ? (
              <div className="pl-6 space-y-0.5" aria-label="Hall servers">
                {props.hallGuilds.map((g) => (
                  <NavLink
                    key={g.id}
                    to={`/halls/${g.id}`}
                    className="scout-app-sidebar-link flex items-center gap-2 px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate">{g.name}</span>
                  </NavLink>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function ChatsSection(props: {
  inExplore: boolean;
  exploreAvailable: boolean;
  activeConversationId: string | null;
}) {
  const navigate = useNavigate();

  if (!props.inExplore || !props.exploreAvailable) return null;

  return (
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
        <ExploreNavigationSection activeId={props.activeConversationId} />
      </div>
    </section>
  );
}

function ServerManagementSection(props: {
  guildId: string;
  guildName: string | undefined;
  guildItems: readonly GuildNavigationItem[];
}) {
  if (props.guildItems.length === 0) return null;

  return (
    <section
      className="min-h-0 flex-1 flex flex-col overflow-hidden border-t border-scout-border/60 pt-2.5"
      aria-label="Server management"
    >
      <p className="scout-app-sidebar-heading truncate">
        {props.guildName ?? "Server"}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto space-y-0.5">
        {props.guildItems.map((item) => {
          const Icon = guildNavIcon(item.to);
          return (
            <NavLink
              key={item.to}
              to={`/g/${props.guildId}/${item.to}`}
              className="scout-app-sidebar-link flex items-center gap-2.5 px-2.5 py-2 text-sm"
            >
              <Icon className="size-4 shrink-0 text-scout-subtle" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </section>
  );
}

function WorkspaceSwitcherSection(props: {
  guildId: string | undefined;
  selectedGuild: { id: string; name: string } | undefined;
  manageableGuilds: readonly { id: string; name: string }[] | undefined;
}) {
  const navigate = useNavigate();

  const selectableGuilds = props.manageableGuilds ?? [];
  if (selectableGuilds.length <= 1) {
    return null;
  }

  const selectedGuild = props.selectedGuild;
  const serverInitials = selectedGuild
    ? selectedGuild.name.slice(0, 2).toUpperCase()
    : null;
  const serverName = selectedGuild ? selectedGuild.name : "Switch server";
  const serverSubtitle = selectedGuild ? "Active server" : "No server selected";

  return (
    <section
      className="scout-app-sidebar-section mt-auto shrink-0 border-t border-scout-border/60 pt-2 space-y-0.5"
      aria-label="Workspace"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-scout-ink transition-colors hover:bg-scout-hover"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-scout-border/60 bg-scout-canvas text-xs font-semibold text-scout-ink">
                {serverInitials ?? (
                  <Server className="size-3.5 text-scout-subtle" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight text-scout-ink">
                  {serverName}
                </p>
                <p className="truncate text-xs leading-tight text-scout-subtle">
                  {serverSubtitle}
                </p>
              </div>
            </div>
            <ChevronsUpDown className="size-4 shrink-0 text-scout-subtle transition-colors group-hover:text-scout-ink" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Servers</DropdownMenuLabel>
          {selectableGuilds.map((guild) => (
            <DropdownMenuItem
              key={guild.id}
              onClick={() => {
                void navigate(guildWorkspacePath(guild.id));
              }}
              className={`flex items-center justify-between gap-2 text-sm ${
                guild.id === props.guildId
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
              {guild.id === props.guildId && (
                <Check className="ml-1 size-4 shrink-0 text-scout-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </section>
  );
}

export function AppNavigation() {
  const location = useLocation();
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
  const challengesQuery = useQuery(
    trpc.challenge.status.queryOptions(undefined, { retry: 2 }),
  );
  const bucksQuery = useQuery(
    trpc.bucks.status.queryOptions(undefined, { retry: 2 }),
  );
  const hallQuery = useQuery(
    trpc.hall.status.queryOptions(undefined, { retry: 2 }),
  );
  const { perms } = usePermissions(guildId);

  const hallGuilds =
    hallQuery.data?.state === "available" ? hallQuery.data.guilds : [];
  const inHalls = location.pathname.startsWith("/halls");
  const hallMatchGuildId = inHalls
    ? /^\/halls\/([^/]+)/.exec(location.pathname)?.[1]
    : undefined;
  const activeHallGuild = hallGuilds.find(
    (guild) => guild.id === (guildId ?? hallMatchGuildId),
  );
  const hallTo = resolveHallTo(activeHallGuild, hallGuilds);

  const tools = consumerNavigationItems({
    exploreAvailable: exploreQuery.data?.enabled === true,
    profilesAvailable: profilesQuery.data?.state === "available",
    challengesAvailable: challengesQuery.data?.enabled === true,
    bucksAvailable: bucksQuery.data?.state === "available",
    hallAvailable: hallQuery.data?.state === "available",
    hallTo,
  });

  const selectedGuild = guildsQuery.data?.find((guild) => guild.id === guildId);

  const guildItems = visibleGuildNavigationItems(
    (permission) => perms.can(permission.resource, permission.action),
    selectedGuild?.customNightsEnabled ?? false,
    selectedGuild?.hallOfFameEnabled ?? false,
  );

  const activeConversationId = getActiveConversationId(location.pathname);

  return (
    <nav className="scout-app-sidebar-nav" aria-label="App navigation">
      <ToolsNavigationSection
        tools={tools}
        inHalls={inHalls}
        hallGuilds={hallGuilds}
      />
      <ChatsSection
        inExplore={isExplorePath(location.pathname)}
        exploreAvailable={exploreQuery.data?.enabled === true}
        activeConversationId={activeConversationId}
      />
      {guildId !== undefined && (
        <ServerManagementSection
          guildId={guildId}
          guildName={selectedGuild?.name}
          guildItems={guildItems}
        />
      )}
      {guildId !== undefined && (
        <WorkspaceSwitcherSection
          guildId={guildId}
          selectedGuild={selectedGuild}
          manageableGuilds={guildsQuery.data}
        />
      )}
    </nav>
  );
}
