import type { Permission } from "@scout-for-lol/data";

export type ConsumerNavigationAvailability = {
  exploreAvailable: boolean;
  profilesAvailable: boolean;
  challengesAvailable: boolean;
  bucksAvailable: boolean;
  hallAvailable?: boolean;
  hallTo?: string;
  duelsAvailable?: boolean;
  duelsTo?: string;
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
    ...(input.duelsAvailable === true && input.duelsTo !== undefined
      ? [{ label: "Duels", to: input.duelsTo }]
      : []),
    ...(input.bucksAvailable ? [{ label: "Bryan Bucks", to: "/bucks" }] : []),
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
  if (hallGuilds.length === 1 && hallGuilds[0] !== undefined) {
    return `/halls/${hallGuilds[0].id}`;
  }
  return "/halls";
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

export function guildWorkspacePath(guildId: string): string {
  return `/g/${guildId}`;
}

export type AppShellMode = "focused" | "workspace";

export function resolveAppShellMode(
  pathname: string,
  signedIn: boolean,
): AppShellMode {
  if (!signedIn) return "focused";
  if (
    pathname === "/welcome" ||
    pathname === "/installed" ||
    pathname === "/login" ||
    pathname.startsWith("/explore/s/")
  ) {
    return "focused";
  }
  return "workspace";
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
