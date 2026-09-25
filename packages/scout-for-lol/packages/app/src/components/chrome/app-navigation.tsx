import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  Bell,
  Coins,
  Compass,
  FileBarChart,
  KeyRound,
  Settings,
  ShieldCheck,
  SquarePen,
  Swords,
  Target,
  Trophy,
  Users,
  Wrench,
} from "lucide-react";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import {
  operationsNavVisible,
  resolveOperationsAccess,
} from "#src/lib/operations/operations-access.ts";
import {
  type GuildNavigationItem,
  consumerNavigationItems,
  guildIdFromAppPath,
  guildWorkspacePath,
  isExplorePath,
  resolveDuelsTo,
  resolveHallTo,
  resolveManageScoutTarget,
  visibleGuildNavigationItems,
} from "#src/lib/routes/app-navigation.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/query/stale-times.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { ExploreNavigationSection } from "#src/components/explore/explore-navigation-section.tsx";

function getActiveConversationId(pathname: string): string | null {
  const match = /^\/(?:app\/)?explore\/([^/]+)/.exec(pathname);
  if (!match) return null;
  return match[1] === "s" ? null : (match[1] ?? null);
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
  if (props.to === "/clash") {
    return <Trophy className="size-4 shrink-0 text-scout-subtle" />;
  }
  if (props.to === "/bucks") {
    return <Coins className="size-4 shrink-0 text-scout-subtle" />;
  }
  if (props.to.startsWith("/halls")) {
    return <Trophy className="size-4 shrink-0 text-scout-subtle" />;
  }
  return props.to.startsWith("/operations") ? (
    <Wrench className="size-4 shrink-0 text-scout-subtle" />
  ) : null;
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

function ManageScoutSection(props: {
  guildId: string | undefined;
  manageableGuilds: readonly { id: string; name: string }[] | undefined;
}) {
  const navigate = useNavigate();
  const manageOverviewValue = "__manage_scout_overview__";
  const manageableGuilds = props.manageableGuilds ?? [];
  const directTarget = resolveManageScoutTarget(manageableGuilds);

  if (directTarget !== undefined) {
    return (
      <section
        className="scout-app-sidebar-section shrink-0 border-t border-scout-border/60 pt-2 space-y-0.5"
        aria-label="Manage Scout"
      >
        <NavLink
          to={directTarget}
          className="scout-app-sidebar-link flex items-center gap-2.5 px-2.5 py-2 text-sm"
        >
          <Settings className="size-4 shrink-0 text-scout-subtle" />
          <span>Manage Scout</span>
        </NavLink>
      </section>
    );
  }

  return (
    <section
      className="scout-app-sidebar-section shrink-0 border-t border-scout-border/60 pt-2 space-y-0.5"
      aria-label="Manage Scout"
    >
      <label
        htmlFor="manage-scout-server"
        className="flex items-center gap-2.5 px-2.5 pt-1 text-sm font-medium text-scout-ink"
      >
        <Settings className="size-4 shrink-0 text-scout-subtle" />
        <span>Manage Scout</span>
      </label>
      <select
        id="manage-scout-server"
        value={props.guildId ?? ""}
        onChange={(event) => {
          const guildId = event.target.value;
          if (guildId === manageOverviewValue) {
            void navigate("/manage");
            return;
          }
          if (guildId.length === 0) return;
          void navigate(guildWorkspacePath(guildId));
        }}
        className="w-full rounded-lg border border-scout-border/60 bg-scout-canvas px-2.5 py-2 text-sm font-medium text-scout-ink outline-none transition-colors hover:bg-scout-hover focus-visible:ring-2 focus-visible:ring-scout-primary"
      >
        <option value="">Select a server</option>
        <option value={manageOverviewValue}>Manage servers…</option>
        {manageableGuilds.map((guild) => (
          <option key={guild.id} value={guild.id}>
            {guild.name}
          </option>
        ))}
      </select>
    </section>
  );
}

function useDuelsNavTarget(guildId: string | undefined, pathname: string) {
  const trpc = useTRPC();
  const duelsQuery = useQuery(
    trpc.duel.status.queryOptions(undefined, { retry: 2 }),
  );
  const duelGuilds =
    duelsQuery.data?.state === "available" ? duelsQuery.data.guilds : [];
  const duelMatchGuildId = pathname.startsWith("/duels")
    ? /^\/duels\/([^/]+)/.exec(pathname)?.[1]
    : undefined;
  const activeDuelGuild = duelGuilds.find(
    (guild) => guild.id === (guildId ?? duelMatchGuildId),
  );
  return {
    available: duelsQuery.data?.state === "available",
    to: resolveDuelsTo(activeDuelGuild, duelGuilds),
  };
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
  const clashQuery = useQuery(
    trpc.clash.status.queryOptions(undefined, { retry: 2 }),
  );
  const bucksQuery = useQuery(
    trpc.bucks.status.queryOptions(undefined, { retry: 2 }),
  );
  const hallQuery = useQuery(
    trpc.hall.status.queryOptions(undefined, { retry: 2 }),
  );
  const duelsNav = useDuelsNavTarget(guildId, location.pathname);
  // Unlike the status probes above, this one answers by refusing: the
  // operations procedures throw FORBIDDEN for a non-operator and NOT_FOUND for
  // a disabled console, so a successful answer is the whole signal and a retry
  // would only repeat a refusal that will not change.
  const operationsQuery = useQuery(
    trpc.operations.availability.queryOptions(undefined, { retry: false }),
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
    clashAvailable: clashQuery.data?.state === "available",
    bucksAvailable: bucksQuery.data?.state === "available",
    hallAvailable: hallQuery.data?.state === "available",
    hallTo,
    duelsAvailable: duelsNav.available,
    ...(duelsNav.to === undefined ? {} : { duelsTo: duelsNav.to }),
    operationsAvailable: operationsNavVisible(
      resolveOperationsAccess({
        hasData: operationsQuery.data !== undefined,
        error: operationsQuery.error,
      }),
    ),
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
      <div className="mt-auto shrink-0">
        <ManageScoutSection
          guildId={guildId}
          manageableGuilds={guildsQuery.data}
        />
      </div>
    </nav>
  );
}
