/** Extended-only genuine Plex administration remap, backed by synthetic protocol responses. */
import type { completionFixture } from "./test-fixture.ts";
import { PrismaPlexAdministration } from "#infrastructure/plex-admin.ts";
import { z } from "zod";

export async function remapCompletionViewer(
  f: Awaited<ReturnType<typeof completionFixture>>,
) {
  const owner = await f.db.mediaUser.findFirstOrThrow({
    where: { role: "owner", restricted: false },
  });
  for (const user of [owner, f.files.user]) {
    const previous = await f.db.credential.findUnique({
      where: { userId_kind: { userId: user.id, kind: "plex" } },
    });
    const payload =
      previous === null
        ? {}
        : z
            .record(z.string(), z.json())
            .parse(
              JSON.parse(
                f.context.cipher.decrypt(
                  previous.ciphertext,
                  `plex:${user.plexAccountId}`,
                ),
              ),
            );
    const ciphertext = f.context.cipher.encrypt(
      JSON.stringify({
        ...payload,
        token: "synthetic-account-token",
        serverToken: payload["serverToken"] ?? "synthetic-server-token",
      }),
      `plex:${user.plexAccountId}`,
    );
    await f.db.credential.upsert({
      where: { userId_kind: { userId: user.id, kind: "plex" } },
      create: { userId: user.id, kind: "plex", ciphertext },
      update: { ciphertext },
    });
  }
  const prior = await f.db.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: f.files.user.id },
  });
  const admin = new PrismaPlexAdministration(
    f.db,
    f.context.cipher,
    {
      resolveServerAccess: () =>
        Promise.resolve({
          accountId: f.files.user.plexAccountId,
          serverMachineId: "fixture-server",
          serverToken: "synthetic-account-token",
          permittedSectionIds: ["1", "2"],
          permittedMediaKinds: ["movie", "series"],
          plexRestricted: false,
        }),
    },
    {
      serverUrl: "http://plex.fixture",
      serverMachineId: "fixture-server",
      transport: (url) => {
        if (url.pathname === "/api/home/users")
          return Promise.resolve(
            new Response(
              `<MediaContainer size="1"><User id="${f.files.user.plexAccountId}" title="Viewer" restricted="0" protected="0"/></MediaContainer>`,
            ),
          );
        if (url.pathname === "/accounts")
          return Promise.resolve(
            Response.json({
              MediaContainer: {
                size: 1,
                Account: [{ id: 42, name: "Viewer", key: "/accounts/42" }],
              },
            }),
          );
        throw new Error(`Unexpected native remap protocol ${url.pathname}`);
      },
    },
  );
  return admin.saveProfile(owner, crypto.randomUUID(), {
    homeUserId: f.files.user.plexAccountId,
    serverAccountId: "42",
    expectedVersion: prior.version,
    confirmedIdentity: true,
  });
}
