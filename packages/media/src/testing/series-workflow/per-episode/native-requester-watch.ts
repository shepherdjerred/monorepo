import type { MediaActor } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PlexClient } from "#integrations/plex.ts";

/** Synthetic requester transport only. Credentials and current access mappings
 * remain genuine database inputs to the production watch reader. The server
 * client supplies physical metadata, while this token owns its watch state. */
export async function nativeSeriesPackRequesterWatchV1(
  context: MediaAutomationContext,
  requester: MediaActor,
) {
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
  const token = `synthetic-native-requester-${crypto.randomUUID()}`;
  await context.db.credential.upsert({
    where: { userId_kind: { userId: requester.id, kind: "plex" } },
    create: {
      userId: requester.id,
      kind: "plex",
      ciphertext: context.cipher.encrypt(
        JSON.stringify({ serverToken: token }),
        `plex:${requester.plexAccountId}`,
      ),
    },
    update: {
      ciphertext: context.cipher.encrypt(
        JSON.stringify({ serverToken: token }),
        `plex:${requester.plexAccountId}`,
      ),
    },
  });
  return (requestedToken: string) => {
    if (requestedToken !== token)
      throw new Error(
        "Native watch did not use its actual requester credential",
      );
    return new PlexClient(
      {
        baseUrl: "http://plex.fixture",
        token: requestedToken,
        clientIdentifier: "synthetic-native-requester-watch",
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
  };
}
