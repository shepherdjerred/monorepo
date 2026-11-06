import { MediaAuth, type MediaActor } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { z } from "zod";

/** Persist current identity/access through the real PIN and session producers, not a mapping backfill. */
export async function authenticateMovieFixtureOwner(
  context: MediaAutomationContext,
  owner: MediaActor,
  options: { ownerAccountId?: string } = {},
) {
  const ownerAccountId = options.ownerAccountId ?? owner.plexAccountId;
  const tokenPrefix =
    ownerAccountId === owner.plexAccountId
      ? "synthetic-caption-owner"
      : `synthetic-history-member-${owner.id}`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Synthetic Plex owner authorization"),
  });
  try {
    const sections = await context.permittedSections();
    const serverMachineId = z.string().min(1).parse(context.serverMachineId);
    const auth = new MediaAuth(
      new PrismaAuthStore(context.db),
      {
        createPin: () =>
          Promise.resolve({
            id: 42,
            code: "synthetic-caption-owner-code",
            expiresAt: new Date(Date.now() + 60_000),
            authorizationUrl: server.url.origin,
            deviceState: "synthetic-caption-owner-device",
          }),
        resolvePin: () =>
          Promise.resolve({
            accountId: owner.plexAccountId,
            displayName: owner.displayName,
            token: `${tokenPrefix}-account-token`,
          }),
        resolveServerToken: () =>
          Promise.reject(
            new Error(
              "Exact current access must come from a complete Plex observation",
            ),
          ),
        resolveServerAccess: () =>
          Promise.resolve({
            accountId: owner.plexAccountId,
            serverMachineId,
            serverToken: `${tokenPrefix}-server-token`,
            permittedSectionIds: [sections.movie, sections.series],
            permittedMediaKinds: ["movie", "series"],
            plexRestricted: false,
          }),
        refresh: () =>
          Promise.reject(
            new Error(
              "Current fixture owner login must not reuse a historical credential",
            ),
          ),
      },
      context.cipher,
      { ownerAccountId, sessionLifetimeMs: 60_000 },
    );
    const pending = await auth.start();
    const authorization = await fetch(pending.authorizationUrl);
    if (authorization.status !== 200)
      throw new Error("Synthetic Plex authorization page unavailable");
    const completed = await auth.poll(pending.id, pending.browserToken);
    if (completed === null)
      throw new Error("Actual owner PIN completion omitted its session");
    const authenticated = await auth.authenticate(completed.sessionToken);
    return authenticated.actor;
  } finally {
    await server.stop(true);
  }
}
