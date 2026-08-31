import type { Permission } from "@scout-for-lol/data";

export type ConsumerNavigationAvailability = {
  exploreAvailable: boolean;
  profilesAvailable: boolean;
  bucksAvailable: boolean;
};

export function consumerNavigationItems(
  input: ConsumerNavigationAvailability,
): { label: string; to: string }[] {
  return [
    ...(input.exploreAvailable ? [{ label: "Explore", to: "/explore" }] : []),
    ...(input.profilesAvailable ? [{ label: "Players", to: "/players" }] : []),
    ...(input.bucksAvailable ? [{ label: "Bryan Bucks", to: "/bucks" }] : []),
  ];
}

export type GuildNavigationItem = {
  to: string;
  label: string;
  permission: Permission;
  betaFeature?: "customs";
};

export const GUILD_NAVIGATION_ITEMS: readonly GuildNavigationItem[] = [
  {
    to: "customs",
    label: "Customs",
    permission: { resource: "customs", action: "read" },
    betaFeature: "customs",
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
): readonly GuildNavigationItem[] {
  return GUILD_NAVIGATION_ITEMS.filter(
    (item) =>
      canRead(item.permission) &&
      (item.betaFeature !== "customs" || customNightsEnabled),
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
