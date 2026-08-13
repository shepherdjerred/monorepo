import { describe, expect, test } from "bun:test";
import { isValidElement } from "react";
import type { RouteObject } from "react-router";
import { routes } from "#src/router.tsx";
import { RootLayout } from "#src/routes/root-layout.tsx";
import { RequireSession } from "#src/routes/require-session.tsx";

/**
 * `RootLayout` owns the PostHog identity sync, so any route that does not
 * render through it can never reset a stale identity. `/login` is the route
 * that matters: it is where a visitor with an expired cookie actually lands,
 * and it is deliberately mounted outside `RequireSession`. Wiring identity into
 * the guard instead left exactly that page attributed to the previous account.
 */
function elementType(route: RouteObject): unknown {
  return isValidElement(route.element) ? route.element.type : undefined;
}

function collectPaths(route: RouteObject): string[] {
  const here = route.path === undefined ? [] : [route.path];
  const below = (route.children ?? []).flatMap((child) => collectPaths(child));
  return [...here, ...below];
}

describe("router analytics identity coverage", () => {
  const rootRoutes = routes.filter(
    (route) => elementType(route) === RootLayout,
  );

  test("every route renders through the layout that syncs identity", () => {
    expect(rootRoutes).toHaveLength(1);
    expect(routes).toHaveLength(rootRoutes.length);
  });

  test("the public login route is covered by the layout, not the session guard", () => {
    const root = rootRoutes[0];
    if (root === undefined) throw new Error("no RootLayout route");
    const children = root.children ?? [];

    // Directly under the layout — so it renders through the identity sync.
    expect(children.some((route) => route.path === "login")).toBe(true);

    // …and not under the guard, which only renders for people who still have a
    // session and therefore can never observe one ending.
    const guard = children.find(
      (route) => elementType(route) === RequireSession,
    );
    if (guard === undefined) throw new Error("no RequireSession route");
    expect(collectPaths(guard)).not.toContain("login");
  });
});
