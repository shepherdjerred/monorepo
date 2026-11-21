import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let app: PrismaMediaApplication;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  app = new PrismaMediaApplication(cluster.database, {
    keepDays: 30,
    serverMachineId: "fixture-server",
  });
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

async function fixture() {
  const db = cluster.database;
  const user = (role: "owner" | "member") =>
    db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: `Profile ${role}`,
        role,
      },
    });
  const owner = await user("owner");
  const member = await user("member");
  const profile = await db.qualityProfile.create({
    data: {
      name: `Profile ${crypto.randomUUID()}`,
      rules: { qualities: ["WEB-1080p"], preferredGroups: ["private-group"] },
    },
  });
  await db.qualityProfileDefault.upsert({
    where: { kind: "movie" },
    create: { kind: "movie", profileId: profile.id },
    update: { profileId: profile.id },
  });
  return { db, owner, member, profile };
}

test("the profile list reaches only the owner; anyone else reads an empty list", async () => {
  const f = await fixture();
  const profiles = await app.profiles(f.owner);
  expect(profiles.find((row) => row.id === f.profile.id)).toMatchObject({
    name: f.profile.name,
    rules: { preferredGroups: ["private-group"] },
  });
  // The previous client's title page still asks for the list: empty, not refused.
  expect(await app.profiles(f.member)).toEqual([]);
  // The stored role decides, not the role a signed-in session still carries.
  expect(await app.profiles({ ...f.member, role: "owner" })).toEqual([]);
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { role: "member" },
  });
  expect(await app.profiles(f.owner)).toEqual([]);
});

test("the profile defaults reach only the owner; anyone else is refused", async () => {
  const f = await fixture();
  const defaults = await app.profileDefaults(f.owner);
  expect(defaults.find((row) => row.kind === "movie")).toMatchObject({
    profileId: f.profile.id,
  });
  await expect(app.profileDefaults(f.member)).rejects.toMatchObject({
    code: "forbidden",
    status: 403,
  });
  await expect(
    app.profileDefaults({ ...f.member, role: "owner" }),
  ).rejects.toMatchObject({ code: "forbidden", status: 403 });
});

test("a session whose account no longer exists reads neither", async () => {
  const f = await fixture();
  const gone = { ...f.owner, plexAccountId: crypto.randomUUID() };
  await expect(app.profiles(gone)).rejects.toMatchObject({
    code: "unauthenticated",
    status: 401,
  });
  await expect(app.profileDefaults(gone)).rejects.toMatchObject({
    code: "unauthenticated",
    status: 401,
  });
});
