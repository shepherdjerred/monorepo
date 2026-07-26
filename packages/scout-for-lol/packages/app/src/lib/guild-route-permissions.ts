import { matchPath } from "react-router";
import type { Permission } from "@scout-for-lol/data";

export const GUILD_ACTION_PERMISSIONS = {
  competitionCreate: { resource: "competitions", action: "create" },
  competitionUpdate: { resource: "competitions", action: "update" },
  reportCreate: { resource: "reports", action: "create" },
  reportUpdate: { resource: "reports", action: "update" },
} satisfies Record<string, Permission>;

const GUILD_ACTION_ROUTES: {
  path: string;
  permission: Permission;
}[] = [
  {
    path: "/g/:guildId/competitions/new",
    permission: GUILD_ACTION_PERMISSIONS.competitionCreate,
  },
  {
    path: "/g/:guildId/competitions/:competitionId/edit",
    permission: GUILD_ACTION_PERMISSIONS.competitionUpdate,
  },
  {
    path: "/g/:guildId/reports/new",
    permission: GUILD_ACTION_PERMISSIONS.reportCreate,
  },
  {
    path: "/g/:guildId/reports/:reportId/edit",
    permission: GUILD_ACTION_PERMISSIONS.reportUpdate,
  },
];

/**
 * Return the action permission for an action-only child route. These routes
 * must reach their own action gate even when the caller lacks the section's
 * read permission.
 */
export function permissionForGuildActionRoute(
  pathname: string,
): Permission | null {
  return (
    GUILD_ACTION_ROUTES.find((route) =>
      matchPath({ path: route.path, end: true }, pathname),
    )?.permission ?? null
  );
}
