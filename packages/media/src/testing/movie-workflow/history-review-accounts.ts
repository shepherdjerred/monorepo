import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PrismaPlexAdministration } from "#infrastructure/plex-admin.ts";
import type { PlexServerAccess } from "#application/plex-access.ts";

/** Real owner-confirmed server account mapping after each independent person's actual PIN/session completion. */
export async function mapMovieHistoryAccounts(
  context: MediaAutomationContext,
  owner: MediaActor,
  household: readonly MediaActor[],
) {
  const serverMachineId = z.string().min(1).parse(context.serverMachineId);
  const sections = await context.permittedSections();
  const permissions = new Map<string, PlexServerAccess>();
  for (const person of household) {
    const stored = await context.db.credential.findUniqueOrThrow({
      where: { userId_kind: { userId: person.id, kind: "plex" } },
    });
    const credential = z
      .object({ token: z.string(), serverToken: z.string() })
      .parse(
        JSON.parse(
          context.cipher.decrypt(
            stored.ciphertext,
            `plex:${person.plexAccountId}`,
          ),
        ),
      );
    permissions.set(credential.token, {
      accountId: person.plexAccountId,
      serverMachineId,
      serverToken: credential.serverToken,
      permittedSectionIds: [sections.movie, sections.series],
      permittedMediaKinds: ["movie", "series"],
      plexRestricted: false,
    });
  }
  const admin = new PrismaPlexAdministration(
    context.db,
    context.cipher,
    {
      resolveServerAccess: (token) => {
        const access = permissions.get(token);
        if (access === undefined)
          throw new Error(
            "Unexpected synthetic independent-account credential",
          );
        return Promise.resolve(access);
      },
    },
    {
      serverUrl: "http://history-profile.fixture",
      serverMachineId,
      transport: (url) => {
        if (url.pathname === "/api/home/users")
          return Promise.resolve(
            new Response(
              `<MediaContainer size="${String(household.length)}">${household
                .map(
                  (person) =>
                    `<User id="${person.plexAccountId}" title="Independent fixture account" restricted="0" protected="0"/>`,
                )
                .join("")}</MediaContainer>`,
            ),
          );
        if (url.pathname === "/accounts")
          return Promise.resolve(
            Response.json({
              MediaContainer: {
                size: household.length,
                Account: household.map((_person, index) => ({
                  id: index + 1,
                  name: "Independent fixture account",
                  key: `/accounts/${String(index + 1)}`,
                })),
              },
            }),
          );
        return Promise.reject(
          new Error(
            `Unexpected actual account mapping request ${url.pathname}`,
          ),
        );
      },
    },
  );
  for (const [index, person] of household.entries()) {
    const mapping = await context.db.plexIdentityMapping.findUniqueOrThrow({
      where: { userId: person.id },
    });
    await admin.saveProfile(owner, crypto.randomUUID(), {
      homeUserId: person.plexAccountId,
      serverAccountId: String(index + 1),
      expectedVersion: mapping.version,
      confirmedIdentity: true,
    });
  }
  return admin;
}
