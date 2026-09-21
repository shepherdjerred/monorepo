import type { Permission } from "@scout-for-lol/data";

export type ConsumerNavigationAvailability = {
  exploreAvailable: boolean;
  profilesAvailable: boolean;
  challengesAvailable: boolean;
  clashAvailable?: boolean;
  bucksAvailable: boolean;
  hallAvailable?: boolean;
  hallTo?: string;
  duelsAvailable?: boolean;
  duelsTo?: string;
  /**
   * Whether the server would serve the operations console to this session.
   *
   * Read off an operations procedure rather than a client-side flag, because
   * the two checks behind it are the allowlist and the rollout flag, and only
   * the server can answer either. Absent means "do not offer it", which is what
   * every non-operator sees.
   */
  operationsAvailable?: boolean;
};

export function consumerNavigationItems(
  input: ConsumerNavigationAvailability,
): { label: string; to: string }[] {
  return [
    ...(input.exploreAvailable ? [{ label: "Explore", to: "/explore" }] : []),
    ...(input.profilesAvailable ? [{ label: "Players", to: "/players" }] : []),
    ...(input.hallAvailable === true
      ? [{ label: "Hall of Fame", to: input.hallTo ?? "/halls" }]
      : []),
    ...(input.challengesAvailable
      ? [{ label: "Challenges", to: "/challenges" }]
      : []),
    ...(input.clashAvailable === true
      ? [{ label: "Clash", to: "/clash" }]
      : []),
    ...(input.duelsAvailable === true && input.duelsTo !== undefined
      ? [{ label: "Duels", to: input.duelsTo }]
      : []),
    ...(input.bucksAvailable ? [{ label: "Bryan Bucks", to: "/bucks" }] : []),
    // Last, and only for an operator the server has already agreed to serve.
    // Hiding it is not the access control — the operations router refuses a
    // non-operator whatever this list says — it only keeps the sidebar from
    // advertising a surface that would refuse the reader.
    ...(input.operationsAvailable === true
      ? [{ label: "Operations", to: "/operations/matches" }]
      : []),
  ];
}

/**
 * Duels routes are guild-scoped with no bare index route, so the nav entry
 * needs a concrete guild: the active one when it has duels enabled, else the
 * first enabled guild, else no entry at all.
 */
export function resolveDuelsTo(
  activeDuelGuild: { id: string } | undefined,
  duelGuilds: readonly { id: string }[],
): string | undefined {
  const target = activeDuelGuild ?? duelGuilds[0];
  return target === undefined ? undefined : `/duels/${target.id}`;
}

export function resolveHallTo(
  activeHallGuild: { id: string } | undefined,
  hallGuilds: readonly { id: string }[],
): string {
  if (activeHallGuild !== undefined) {
    return `/halls/${activeHallGuild.id}`;
  }
  return hallGuilds.length === 1 && hallGuilds[0] !== undefined
    ? `/halls/${hallGuilds[0].id}`
    : "/halls";
}

export type GuildNavigationItem = {
  to: string;
  label: string;
  permission: Permission;
  additionalPermissions?: readonly Permission[];
  feature?: "customs" | "hall_of_fame";
};

export const GUILD_NAVIGATION_ITEMS: readonly GuildNavigationItem[] = [
  {
    to: "customs",
    label: "Customs",
    permission: { resource: "customs", action: "read" },
    feature: "customs",
  },
  {
    to: "subscriptions",
    label: "Subscriptions",
    permission: { resource: "subscriptions", action: "read" },
  },
  {
    to: "players",
    label: "Players",
    permission: { resource: "players", action: "read" },
  },
  {
    to: "competitions",
    label: "Competitions",
    permission: { resource: "competitions", action: "read" },
  },
  {
    to: "reports",
    label: "Reports",
    permission: { resource: "reports", action: "read" },
  },
  {
    to: "hall-of-fame",
    label: "Hall settings",
    permission: { resource: "reports", action: "read" },
    additionalPermissions: [{ resource: "reports", action: "update" }],
    feature: "hall_of_fame",
  },
  {
    to: "audit",
    label: "Audit",
    permission: { resource: "audit", action: "read" },
  },
  {
    to: "access",
    label: "Access",
    permission: { resource: "roles", action: "read" },
  },
];

export function visibleGuildNavigationItems(
  canRead: (permission: Permission) => boolean,
  customNightsEnabled = false,
  hallOfFameEnabled = false,
): readonly GuildNavigationItem[] {
  return GUILD_NAVIGATION_ITEMS.filter(
    (item) =>
      canRead(item.permission) &&
      (item.additionalPermissions?.every((permission) => canRead(permission)) ??
        true) &&
      (item.feature !== "customs" || customNightsEnabled) &&
      (item.feature !== "hall_of_fame" || hallOfFameEnabled),
  );
}

/** The section used when a server workspace opens at its index route. */
export function resolveGuildWorkspaceLanding(
  canRead: (permission: Permission) => boolean,
  customNightsEnabled = false,
  hallOfFameEnabled = false,
): string | undefined {
  return visibleGuildNavigationItems(
    canRead,
    customNightsEnabled,
    hallOfFameEnabled,
  )[0]?.to;
}

export function guildWorkspacePath(guildId: string): string {
  return `/g/${guildId}`;
}

/** The Manage Scout control selects directly only when there is one server. */
export function resolveManageScoutTarget(
  manageableGuilds: readonly { id: string }[],
): string | undefined {
  if (manageableGuilds.length === 0) return "/manage";
  if (manageableGuilds.length === 1) {
    const guild = manageableGuilds[0];
    if (guild === undefined) throw new Error("manageable guild is missing");
    return guildWorkspacePath(guild.id);
  }
  return undefined;
}

export type AppShellMode = "focused" | "workspace";

export function resolveAppShellMode(
  pathname: string,
  signedIn: boolean,
): AppShellMode {
  if (!signedIn) return "focused";
  return pathname === "/welcome" ||
    pathname === "/installed" ||
    pathname === "/login" ||
    pathname.startsWith("/explore/s/")
    ? "focused"
    : "workspace";
}

export function guildIdFromAppPath(pathname: string): string | undefined {
  return /^\/g\/([^/]+)/.exec(pathname)?.[1];
}

export function isExplorePath(pathname: string): boolean {
  return (
    pathname === "/explore" ||
    pathname.startsWith("/explore/") ||
    pathname.startsWith("/app/explore")
  );
}

export function shouldRenderGlobalFooter(pathname: string): boolean {
  return !isExplorePath(pathname);
}
