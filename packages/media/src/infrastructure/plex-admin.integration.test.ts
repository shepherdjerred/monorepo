import { beforeAll, afterAll, test, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { CredentialCipher } from "#application/security.ts";
import type { PlexServerAccess } from "#application/plex-access.ts";
import { PrismaPlexAdministration } from "./plex-admin.ts";
import { authorizeRequester } from "./requester-authorization.ts";
import type { MediaActor } from "#application/auth.ts";
import { PrismaNumberingAdministration } from "./numbering-admin.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
let owner: MediaActor;
let permitted = true;
let admin: PrismaPlexAdministration;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  owner = await cluster.database.mediaUser.create({
    data: { plexAccountId: "100", displayName: "Owner", role: "owner" },
  });
  await cluster.database.credential.create({
    data: {
      userId: owner.id,
      kind: "plex",
      ciphertext: cipher.encrypt(
        JSON.stringify({
          token: "fixture-owner",
          serverToken: "fixture-server",
        }),
        "plex:100",
      ),
    },
  });
  admin = new PrismaPlexAdministration(
    cluster.database,
    cipher,
    {
      resolveServerAccess: async (): Promise<PlexServerAccess | null> =>
        permitted
          ? {
              accountId: "20",
              serverMachineId: "server",
              serverToken: "fixture-managed-scoped",
              permittedSectionIds: ["2"],
              permittedMediaKinds: ["series"],
              plexRestricted: true,
            }
          : null,
    },
    {
      serverUrl: "http://plex.fixture",
      serverMachineId: "server",
      transport: async (url) => {
        if (url.pathname === "/api/home/users")
          return new Response(
            '<MediaContainer size="2"><User id="10" title="Alex" restricted="1" protected="0"/><User id="20" title="Alex" restricted="1" protected="1"/></MediaContainer>',
          );
        if (url.pathname === "/api/home/users/20/switch")
          return new Response(
            '<user id="20" authenticationToken="fixture-profile-token"/>',
          );
        if (url.pathname === "/accounts")
          return Response.json({
            MediaContainer: {
              size: 2,
              Account: [
                { id: 2, name: "Alex", key: "/accounts/2" },
                { id: 3, name: "Alex", key: "/accounts/3" },
              ],
            },
          });
        throw new Error("Unexpected Plex fixture endpoint");
      },
    },
  );
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});

test("absolute numbering preserves canonical IDs, rejects collisions and stale edits, and revokes pending intent", async () => {
  const numbering = new PrismaNumberingAdministration(cluster.database);
  const series = await cluster.database.mediaItem.create({
    data: { kind: "series", title: "Anime fixture" },
  });
  const first = await cluster.database.mediaItem.create({
    data: {
      kind: "episode",
      parentId: series.id,
      title: "First",
      seasonNumber: 2,
      episodeNumber: 1,
      externalIds: { tvdbId: 123 },
      intent: { create: {} },
    },
  });
  const second = await cluster.database.mediaItem.create({
    data: {
      kind: "episode",
      parentId: series.id,
      title: "Second",
      seasonNumber: 2,
      episodeNumber: 2,
    },
  });
  const input = {
    expectedVersion: 0,
    absoluteNumber: 25,
    evidence:
      "Official episode list maps absolute 25 to season two episode one",
  };
  await expect(
    numbering.save(owner, "numbering-map-first", first.id, input),
  ).resolves.toMatchObject({ status: "completed", version: 1 });
  expect(
    await cluster.database.mediaItem.findUnique({ where: { id: first.id } }),
  ).toMatchObject({
    seasonNumber: 2,
    episodeNumber: 1,
    externalIds: { tvdbId: 123, absoluteNumber: 25 },
  });
  expect(
    await cluster.database.mediaIntent.findUnique({
      where: { mediaId: first.id },
    }),
  ).toMatchObject({ generation: 1 });
  await expect(
    numbering.save(owner, "numbering-map-collision", second.id, input),
  ).rejects.toMatchObject({ code: "numbering_conflict" });
  await expect(
    numbering.save(owner, "numbering-map-stale", first.id, input),
  ).rejects.toMatchObject({ code: "version_conflict" });
  await expect(
    numbering.save(owner, "numbering-clear", first.id, {
      ...input,
      expectedVersion: 1,
      absoluteNumber: null,
    }),
  ).resolves.toMatchObject({ version: 2 });
  expect(await numbering.episodes(owner, series.id)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: first.id, absoluteNumber: null }),
    ]),
  );
});

test("maps duplicate names by explicit IDs, encrypts Home credentials and permits only scoped owner requests", async () => {
  const input = {
    homeUserId: "20",
    serverAccountId: "3",
    expectedVersion: null,
    confirmedIdentity: true as const,
    pin: "1234",
  };
  await expect(
    admin.saveProfile(owner, "map-home-alex", input),
  ).resolves.toMatchObject({ status: "completed" });
  await expect(
    admin.saveProfile(owner, "map-home-alex", input),
  ).resolves.toMatchObject({ status: "completed" });
  const profile = await cluster.database.mediaUser.findUniqueOrThrow({
    where: { plexAccountId: "20" },
  });
  expect(
    await cluster.database.mediaUser.findUnique({
      where: { plexAccountId: "10" },
    }),
  ).toBeNull();
  const mapping = await cluster.database.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: profile.id },
  });
  expect(mapping).toMatchObject({
    homeUserId: "20",
    serverAccountId: "3",
    kind: "managed",
    permittedSectionIds: ["2"],
  });
  const stored = await cluster.database.credential.findUniqueOrThrow({
    where: { userId_kind: { userId: profile.id, kind: "plex" } },
  });
  expect(stored.ciphertext).not.toContain("fixture-profile-token");
  expect(
    JSON.parse(cipher.decrypt(stored.ciphertext, "plex:20")),
  ).toMatchObject({ serverToken: "fixture-managed-scoped" });
  expect(JSON.stringify(await admin.profiles(owner))).not.toContain("token");
  expect(
    JSON.stringify(await cluster.database.applicationEvent.findMany()),
  ).not.toContain("1234");
  await expect(
    cluster.database.$transaction(async (tx) => {
      await authorizeRequester(tx, owner, profile.id, {
        kind: "episode",
        serverMachineId: "server",
      });
    }),
  ).resolves.toBeUndefined();
  await expect(
    cluster.database.$transaction(async (tx) => {
      await authorizeRequester(tx, owner, profile.id, {
        kind: "movie",
        serverMachineId: "server",
      });
    }),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
  await expect(
    admin.saveProfile(owner, "stale-home-mapping", input),
  ).rejects.toMatchObject({ code: "version_conflict" });
});

test("revoked Home access clears scope, preserves profile identity, and cannot create requests", async () => {
  const profile = await cluster.database.mediaUser.findUniqueOrThrow({
    where: { plexAccountId: "20" },
  });
  permitted = false;
  await expect(
    admin.refreshProfileAccess(owner, profile.id),
  ).rejects.toMatchObject({ code: "plex_profile_reconnect" });
  expect(
    await cluster.database.plexIdentityMapping.findUnique({
      where: { userId: profile.id },
    }),
  ).toMatchObject({
    homeUserId: "20",
    serverAccountId: "3",
    permittedSectionIds: [],
    verifiedAt: null,
  });
  await expect(
    cluster.database.$transaction(async (tx) => {
      await authorizeRequester(tx, owner, profile.id, {
        kind: "episode",
        serverMachineId: "server",
      });
    }),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
  await expect(admin.profiles(profile)).rejects.toMatchObject({
    code: "forbidden",
  });
});
