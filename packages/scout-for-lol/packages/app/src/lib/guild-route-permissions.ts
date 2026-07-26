import { matchPath } from "react-router";
import type { Permission } from "@scout-for-lol/data";

export const GUILD_ACTION_ROUTE_PERMISSIONS = {
  competitionCreate: [{ resource: "competitions", action: "create" }],
  competitionEdit: [
    { resource: "competitions", action: "update" },
    { resource: "competitions", action: "read" },
  ],
  reportCreate: [{ resource: "reports", action: "create" }],
  reportEdit: [
    { resource: "reports", action: "update" },
    { resource: "reports", action: "read" },
  ],
} satisfies Record<string, readonly Permission[]>;

const GUILD_ACTION_ROUTES: {
  path: string;
  permissions: readonly Permission[];
}[] = [
  {
    path: "/g/:guildId/competitions/new",
    permissions: GUILD_ACTION_ROUTE_PERMISSIONS.competitionCreate,
  },
  {
    path: "/g/:guildId/competitions/:competitionId/edit",
    permissions: GUILD_ACTION_ROUTE_PERMISSIONS.competitionEdit,
  },
  {
    path: "/g/:guildId/reports/new",
    permissions: GUILD_ACTION_ROUTE_PERMISSIONS.reportCreate,
  },
  {
    path: "/g/:guildId/reports/:reportId/edit",
    permissions: GUILD_ACTION_ROUTE_PERMISSIONS.reportEdit,
  },
];

/**
 * Return every permission required by a form child route. Create forms only
 * need their create action; edit forms also need read access because they load
 * the current resource before submitting an update.
 */
export function permissionsForGuildActionRoute(
  pathname: string,
): readonly Permission[] | null {
  return (
    GUILD_ACTION_ROUTES.find((route) =>
      matchPath({ path: route.path, end: true }, pathname),
    )?.permissions ?? null
  );
}
