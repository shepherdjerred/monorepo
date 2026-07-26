import { describe, expect, test } from "bun:test";
import { matchRoutes } from "react-router";
import { routes } from "#src/router.tsx";
import { trpcOptions } from "#src/lib/trpc-options.ts";

/**
 * Every URL the JSX `<Routes>` tree served must still resolve through the
 * data-router route objects, and unknown URLs must fall through to the catch-all
 * (which redirects to `/`).
 */
const KNOWN_URLS = [
  "/login",
  "/",
  "/welcome",
  "/installed",
  "/g/1/subscriptions",
  "/g/1/players",
  "/g/1/players/Alias",
  "/g/1/competitions",
  "/g/1/competitions/new",
  "/g/1/competitions/5",
  "/g/1/competitions/5/edit",
  "/g/1/reports",
  "/g/1/reports/help",
  "/g/1/reports/new",
  "/g/1/reports/7",
  "/g/1/reports/7/edit",
  "/g/1/audit",
  "/g/1/access",
];

describe("router route matching", () => {
  test.each(KNOWN_URLS)("matches %s to a concrete (non-splat) route", (url) => {
    const matches = matchRoutes(routes, url);
    expect(matches).not.toBeNull();
    const leaf = matches?.at(-1)?.route;
    expect(leaf).toBeDefined();
    expect(leaf?.path).not.toBe("*");
  });

  test("an unknown URL falls through to the catch-all splat", () => {
    const matches = matchRoutes(routes, "/totally-unknown-path");
    expect(matches).not.toBeNull();
    expect(matches?.at(-1)?.route.path).toBe("*");
  });
});

describe("trpc query-key parity", () => {
  test("getPlayer queryOptions produces the canonical tRPC query key", () => {
    // queryKey carries tRPC's `dataTag` brand; widen to `unknown` so the
    // structural `toEqual` compares the runtime shape, not the branded type.
    const queryKey: unknown = trpcOptions.player.getPlayer.queryOptions({
      guildId: "1",
      alias: "a",
    }).queryKey;
    expect(queryKey).toEqual([
      ["player", "getPlayer"],
      { input: { guildId: "1", alias: "a" }, type: "query" },
    ]);
  });
});
