import { describe, expect, test } from "bun:test";
import {
  GUILD_ACTION_ROUTE_PERMISSIONS,
  permissionsForGuildActionRoute,
} from "#src/lib/guild-route-permissions.ts";

describe("permissionsForGuildActionRoute", () => {
  test.each([
    [
      "/g/123/competitions/new",
      GUILD_ACTION_ROUTE_PERMISSIONS.competitionCreate,
    ],
    [
      "/g/123/competitions/456/edit",
      GUILD_ACTION_ROUTE_PERMISSIONS.competitionEdit,
    ],
    ["/g/123/reports/new", GUILD_ACTION_ROUTE_PERMISSIONS.reportCreate],
    ["/g/123/reports/456/edit", GUILD_ACTION_ROUTE_PERMISSIONS.reportEdit],
  ])("maps %s to all required permissions", (pathname, permissions) => {
    expect(permissionsForGuildActionRoute(pathname)).toEqual(permissions);
  });

  test.each([
    "/g/123/competitions",
    "/g/123/competitions/456",
    "/g/123/reports",
    "/g/123/reports/456",
    "/g/123/reports/456/edit/history",
  ])("does not exempt read routes from the section guard: %s", (pathname) => {
    expect(permissionsForGuildActionRoute(pathname)).toBeNull();
  });
});
