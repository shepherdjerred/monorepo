import { beforeAll, afterAll, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { CredentialCipher } from "#application/security.ts";
import { PrismaAdminApplication } from "./admin-service.ts";
import type { MediaActor } from "#application/auth.ts";
import type { SaveProvider, ManualSubtitle } from "#shared/admin.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let admin: PrismaAdminApplication;
let owner: MediaActor;
let member: MediaActor;
const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  admin = new PrismaAdminApplication(cluster.database, cipher);
  owner = await cluster.database.mediaUser.create({
    data: {
      plexAccountId: "owner-fixture",
      displayName: "Owner",
      role: "owner",
    },
  });
  member = await cluster.database.mediaUser.create({
    data: { plexAccountId: "member-fixture", displayName: "Member" },
  });
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});

test("encrypts provider credentials, keeps reads/events secret-free, and rejects stale updates", async () => {
  const settings: SaveProvider = {
    expectedUpdatedAt: null,
    enabled: true,
    configuration: { minimumIntervalSeconds: 30, dailyDownloadLimit: 10 },
    seedingPolicy: { kind: "unknown" },
    credential: {
      username: "fixture-user",
      password: "fixture-password",
      pid: "fixture-private-passkey",
    },
  };
  await expect(
    admin.saveProvider(owner, "configure-privatehd", "privatehd", settings),
  ).resolves.toMatchObject({ status: "completed" });
  await expect(
    admin.saveProvider(owner, "configure-privatehd", "privatehd", {
      ...settings,
      credential: {
        ...settings.credential,
        password: "different-fixture-password",
      },
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  await expect(
    admin.saveProvider(owner, "configure-privatehd", "privatehd", settings),
  ).resolves.toMatchObject({ status: "completed" });
  const stored = await cluster.database.mediaProvider.findUniqueOrThrow({
    where: { id: "privatehd" },
  });
  const credential = await cluster.database.credential.findUniqueOrThrow({
    where: { id: stored.credentialId ?? "missing" },
  });
  expect(credential.ciphertext).not.toContain("fixture-password");
  expect(
    JSON.parse(cipher.decrypt(credential.ciphertext, "provider:privatehd")),
  ).toEqual(settings.credential);
  const publicState = JSON.stringify(await admin.providers(owner));
  const events = JSON.stringify(
    await cluster.database.applicationEvent.findMany(),
  );
  for (const value of [
    "fixture-password",
    "fixture-private-passkey",
    credential.ciphertext,
  ]) {
    expect(publicState).not.toContain(value);
    expect(events).not.toContain(value);
  }
  await expect(
    admin.saveProvider(owner, "configure-stale", "privatehd", settings),
  ).rejects.toMatchObject({ code: "version_conflict" });
  const noCredential = {
    ...settings,
    expectedUpdatedAt: stored.updatedAt.toISOString(),
  };
  delete noCredential.credential;
  await admin.saveProvider(
    owner,
    "configure-preserve",
    "privatehd",
    noCredential,
  );
  expect(await cluster.database.credential.count()).toBe(1);
});

test("requires owner access and prevents private trackers from using public cleanup rules", async () => {
  await expect(admin.providers(member)).rejects.toMatchObject({ status: 403 });
  const settings: SaveProvider = {
    expectedUpdatedAt: null,
    enabled: true,
    configuration: { minimumIntervalSeconds: 30, dailyDownloadLimit: 10 },
    seedingPolicy: { kind: "public" },
  };
  expect(() =>
    admin.saveProvider(member, "member-provider", "knaben", settings),
  ).toThrow();
  expect(() =>
    admin.saveProvider(owner, "unsafe-policy", "avistaz", settings),
  ).toThrow("Private trackers");
  await expect(
    admin.saveProvider(owner, "missing-credentials", "assrt", {
      ...settings,
      seedingPolicy: { kind: "unknown" },
    }),
  ).rejects.toMatchObject({ code: "provider_credentials_required" });
});

async function uploadFixture(): Promise<ManualSubtitle> {
  const media = await cluster.database.mediaItem.create({
    data: { title: "Upload fixture", kind: "movie", intent: { create: {} } },
  });
  const asset = await cluster.database.libraryAsset.create({
    data: {
      path: `/data/movies/${media.id}.mkv`,
      checksum: "c".repeat(64),
      owned: true,
      sizeBytes: 100,
      state: "published",
      properties: {},
      coverage: { create: { mediaId: media.id, current: true } },
    },
  });
  return {
    assetId: asset.id,
    expectedAssetVersion: asset.version,
    expectedChecksum: "c".repeat(64),
    language: "en",
    filename: "fixture.srt",
    description: "Human translation matched against the complete video",
    contentBase64: Buffer.from(
      "1\n00:00:01,000 --> 00:00:03,000\nHello\n",
    ).toString("base64"),
    confirmedMatchingVideo: true,
  };
}

test("queues the exact uploaded subtitle once with server-derived video evidence and no content in history", async () => {
  const input = await uploadFixture();
  const first = await admin.uploadSubtitle(owner, "manual-upload", input);
  await expect(
    admin.uploadSubtitle(owner, "manual-upload", input),
  ).resolves.toEqual(first);
  const subtitle = await cluster.database.subtitleAsset.findFirstOrThrow({
    where: { assetId: input.assetId },
  });
  expect(subtitle.matchingEvidence).toMatchObject({
    assetVersion: input.expectedAssetVersion,
    assetChecksum: input.expectedChecksum,
    recoveryEpoch: 0,
    ownerConfirmed: true,
  });
  const operation = await cluster.database.operation.findUniqueOrThrow({
    where: { id: first.operationId ?? "missing" },
  });
  expect(operation.kind).toBe("install_subtitle");
  expect(operation.payload).toMatchObject({ subtitleId: subtitle.id });
  expect(JSON.stringify(operation)).not.toContain(input.contentBase64);
  expect(
    await cluster.database.subtitleAsset.count({
      where: { assetId: input.assetId },
    }),
  ).toBe(1);
  await expect(
    admin.uploadSubtitle(owner, "duplicate-language", input),
  ).rejects.toMatchObject({ code: "subtitle_exists" });
});

test("rejects stale video ownership and invalid or Traditional Chinese subtitle content", async () => {
  const input = await uploadFixture();
  await expect(
    admin.uploadSubtitle(owner, "stale-upload", {
      ...input,
      expectedAssetVersion: 99,
    }),
  ).rejects.toMatchObject({ code: "asset_version_conflict" });
  expect(() => admin.uploadSubtitle(member, "member-upload", input)).toThrow();
  expect(() =>
    admin.uploadSubtitle(owner, "invalid-timing", {
      ...input,
      contentBase64: Buffer.from(
        "1\n00:99:00,000 --> 00:00:01,000\nHello\n",
      ).toString("base64"),
    }),
  ).toThrow("could not be validated");
  expect(() =>
    admin.uploadSubtitle(owner, "traditional-upload", {
      ...input,
      language: "zh-Hans",
      contentBase64: Buffer.from(
        "1\n00:00:01,000 --> 00:00:03,000\n這個電影非常精彩\n",
      ).toString("base64"),
    }),
  ).toThrow("could not be validated");
  expect(
    await cluster.database.subtitleAsset.count({
      where: { assetId: input.assetId },
    }),
  ).toBe(0);
});
