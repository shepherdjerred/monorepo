import type { PromotionTarget } from "#shared/promotion/model.ts";

/** The persistent profile, instance, and initial tab routes for browser access tests. */
export function browserSessionFixtureRoute(
  pathname: string,
  target: PromotionTarget,
): Response | undefined {
  const profileName = `storm-promotion-${target.id}`;
  if (pathname === "/profiles") return Response.json([{ name: profileName }]);
  if (pathname === "/instances")
    return Response.json([{ id: "owned", profileName }]);
  if (pathname === "/instances/owned/tabs") return Response.json([]);
  return pathname.endsWith("/tabs/open")
    ? Response.json({ tabId: "page" })
    : undefined;
}
