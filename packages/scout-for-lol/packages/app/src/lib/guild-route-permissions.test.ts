import { describe, expect, test } from "bun:test";
import {
  GUILD_ACTION_PERMISSIONS,
  permissionForGuildActionRoute,
} from "#src/lib/guild-route-permissions.ts";

describe("permissionForGuildActionRoute", () => {
  test.each([
    ["/g/123/competitions/new", GUILD_ACTION_PERMISSIONS.competitionCreate],
    [
      "/g/123/competitions/456/edit",
      GUILD_ACTION_PERMISSIONS.competitionUpdate,
    ],
    ["/g/123/reports/new", GUILD_ACTION_PERMISSIONS.reportCreate],
    ["/g/123/reports/456/edit", GUILD_ACTION_PERMISSIONS.reportUpdate],
  ])("maps %s to its action permission", (pathname, permission) => {
    expect(permissionForGuildActionRoute(pathname)).toEqual(permission);
  });

  test.each([
    "/g/123/competitions",
    "/g/123/competitions/456",
    "/g/123/reports",
    "/g/123/reports/456",
    "/g/123/reports/456/edit/history",
  ])("does not exempt read routes from the section guard: %s", (pathname) => {
    expect(permissionForGuildActionRoute(pathname)).toBeNull();
  });
});
