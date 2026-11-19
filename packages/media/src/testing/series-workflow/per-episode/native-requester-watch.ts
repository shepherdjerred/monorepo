import type { MediaActor } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PlexClient } from "#integrations/plex.ts";
import { z } from "zod";

/** Synthetic requester transport only. Credentials and current access mappings
 * remain genuine database inputs to the production watch reader. The server
 * client supplies physical metadata, while each distinct token owns only its
 * declared actor's watch state. */
export async function nativeSeriesPackRequesterWatchV1(input: {
  context: MediaAutomationContext;
  user: MediaActor;
  network: { actor: MediaActor };
}) {
  const { context } = input;
  const requesters = [input.user, input.network.actor];
  if (new Set(requesters.map((requester) => requester.id)).size !== 2)
    throw new Error("Native watch requires both distinct household actors");
  const page = await context.plex.libraryPage({
    sectionId: "2",
    kind: "episode",
    offset: 0,
    limit: 100,
  });
  if (page.total !== 24 || page.items.length !== 24)
    throw new Error("Synthetic requester needs the complete actual TV library");
  const episodeKeys = new Set(page.items.map((item) => item.ratingKey));
  const permittedKeys = new Set(
    page.items.flatMap((item) => [
      item.ratingKey,
      ...(item.parentRatingKey === undefined ? [] : [item.parentRatingKey]),
      ...(item.grandparentRatingKey === undefined
        ? []
        : [item.grandparentRatingKey]),
    ]),
  );
  const clients = new Map<string, PlexClient>();
  for (const requester of requesters) {
    const token = `synthetic-native-requester-${crypto.randomUUID()}`;
    const prior = await context.db.credential.findUnique({
      where: { userId_kind: { userId: requester.id, kind: "plex" } },
    });
    // The owner's earlier handoff claim reader still uses its account token.
    // Add current server access without rewriting that payload or any receipt.
    const existing =
      prior === null
        ? {}
        : z
            .record(z.string(), z.json())
            .parse(
              JSON.parse(
                context.cipher.decrypt(
                  prior.ciphertext,
                  `plex:${requester.plexAccountId}`,
                ),
              ),
            );
    const ciphertext = context.cipher.encrypt(
      JSON.stringify({ ...existing, serverToken: token }),
      `plex:${requester.plexAccountId}`,
    );
    await context.db.credential.upsert({
      where: { userId_kind: { userId: requester.id, kind: "plex" } },
      create: { userId: requester.id, kind: "plex", ciphertext },
      update: { ciphertext },
    });
    const client = new PlexClient(
      {
        baseUrl: "http://plex.fixture",
        token,
        clientIdentifier: `synthetic-native-requester-watch-${requester.id}`,
      },
      async (url, init) => {
        if (new Headers(init.headers).get("X-Plex-Token") !== token)
          throw new Error("Synthetic requester transport lost token isolation");
        if (url.pathname === "/identity")
          return Response.json({
            MediaContainer: { machineIdentifier: "fixture-server" },
          });
        if (url.pathname === "/library/sections")
          return Response.json({
            MediaContainer: {
              size: 1,
              Directory: [{ key: "2", type: "show", title: "Synthetic TV" }],
            },
          });
        const prefix = "/library/metadata/";
        const key = url.pathname.slice(prefix.length);
        if (!url.pathname.startsWith(prefix) || !permittedKeys.has(key))
          throw new Error("Synthetic requester escaped its actual TV scope");
        const item = await context.plex.metadata(key, init.signal ?? undefined);
        return Response.json({
          MediaContainer: {
            size: 1,
            Metadata: [{ ...item, viewCount: episodeKeys.has(key) ? 3 : 0 }],
          },
        });
      },
    );
    clients.set(token, client);
  }
  return (requestedToken: string) => {
    const client = clients.get(requestedToken);
    if (client === undefined)
      throw new Error(
        "Native watch did not use a declared actor's actual credential",
      );
    return client;
  };
}
