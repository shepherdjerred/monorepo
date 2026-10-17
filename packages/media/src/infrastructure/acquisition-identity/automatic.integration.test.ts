import { expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import {
  searchCandidates,
  loadProfile,
} from "#automation/acquisition-candidates.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { persistCatalogMedia } from "#infrastructure/catalog-identity/persist.ts";
import { identityHash } from "./snapshot.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { AcquisitionIdentitySnapshotSchema } from "#shared/acquisition/identity.ts";
import { StoredCandidateSchema } from "#automation/providers.ts";

const { database, context } = automationTestHarness();
const OperationInput = z.object({
  operationId: z.uuid(),
  mediaId: z.uuid(),
  generation: z.number().int(),
});

async function automaticFixture(
  legacyReference: "none" | "conflict" | "match" = "none",
) {
  const db = database();
  const f = await fileFixture(db);
  const actor = await db.mediaUser.update({
    where: { id: f.user.id },
    data: { role: "owner" },
  });
  await db.plexIdentityMapping.create({
    data: {
      userId: actor.id,
      serverMachineId: "fixture-server",
      serverAccountId: actor.plexAccountId,
      kind: "account",
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie"],
      verifiedAt: new Date(),
    },
  });
  await db.qualityProfileVersion.create({
    data: {
      profileId: f.profile.id,
      version: 0,
      rules: z.record(z.string(), z.json()).parse(f.profile.rules),
    },
  });
  await db.mediaProvider.upsert({
    where: { id: "knaben" },
    create: { id: "knaben", enabled: true, seedingPolicy: { kind: "public" } },
    update: {},
  });
  const hash = randomBytes(20).toString("hex");
  const source = StoredCandidateSchema.parse({
    providerId: "knaben",
    providerReleaseId: crypto.randomUUID(),
    title: "Test.Film.2026.1080p.WEB-DL.H264.ENG",
    sizeBytes: 20,
    seeders: 5,
    infoHash: hash,
    detailsUrl: "https://provider.fixture/details",
    download: { kind: "magnet", value: `magnet:?xt=urn:btih:${hash}` },
  });
  if (legacyReference !== "none") {
    await db.mediaItem.update({
      where: { id: f.media.id },
      data: {
        externalIds: {
          ...z.record(z.string(), z.json()).parse(f.media.externalIds),
          imdb: "tt1111111",
        },
      },
    });
    source.references = [
      {
        kind: "movie",
        namespace: "imdb",
        value: legacyReference === "conflict" ? "tt2222222" : "tt1111111",
        provenance: { kind: "provider-field", field: "fixture_imdb_id" },
      },
    ];
  }
  const network = {
    ...context(),
    providers: {
      withProvider: async <T>(
        _id: string,
        callback: (provider: {
          search: () => Promise<(typeof source)[]>;
        }) => Promise<T>,
      ) => await callback({ search: () => Promise.resolve([source]) }),
    },
  };
  const profile = await loadProfile(db, f.media.id);
  if (profile === null) throw new Error("Missing fixture profile");
  const found = await searchCandidates(network, f.media.id, profile);
  expect(found).toHaveLength(legacyReference === "conflict" ? 0 : 1);
  const release = await db.releaseCandidate.findUniqueOrThrow({
    where: {
      providerId_providerReleaseId: {
        providerId: source.providerId,
        providerReleaseId: source.providerReleaseId,
      },
    },
  });
  expect(
    PublicReleaseAttributesSchema.parse(release.attributes).identityConfidence,
  ).toBe(legacyReference === "conflict" ? "mismatch" : "exact");
  const service = new PrismaMediaApplication(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
  });
  async function select() {
    const current = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.media.id },
    });
    const result = await service.act(actor, crypto.randomUUID(), current.id, {
      action: "select_release",
      releaseId: release.id,
      expectedVersion: current.version,
    });
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(result.operationId) },
    });
    return OperationInput.parse(operation.payload);
  }
  async function changeCatalog() {
    const tmdbId = z.number().int().positive().parse(f.media.tmdbId);
    const identity = {
      schemaVersion: 1 as const,
      references: [
        {
          kind: "movie" as const,
          namespace: "tmdb" as const,
          value: String(tmdbId),
        },
      ],
      originalTitle: "Test Film",
      aliases: [],
    };
    await db.$transaction(
      async (tx) =>
        await persistCatalogMedia(tx, {
          kind: "movie",
          tmdbId,
          title: "Test Film",
          year: 2025,
          originalLanguage: "en",
          runtimeMinutes: 120,
          identity: { ...identity, evidenceDigest: identityHash(identity) },
        }),
    );
  }
  return {
    f,
    release,
    select,
    changeCatalog,
    service,
    actor,
    activities: createAcquisitionActivities(network),
  };
}

test.each(["selection", "reservation", "submission", "unchanged"])(
  "automatic identity uses current catalog at %s",
  async (phase) => {
    const f = await automaticFixture();
    try {
      const db = database();
      if (phase === "selection") {
        const before = await db.mediaIntent.findUniqueOrThrow({
          where: { mediaId: f.f.media.id },
        });
        await f.changeCatalog();
        await expect(f.select()).rejects.toMatchObject({
          code: "automatic_identity_changed",
        });
        expect(
          await db.mediaIntent.findUniqueOrThrow({
            where: { mediaId: f.f.media.id },
          }),
        ).toEqual(before);
        expect(
          await db.operation.count({
            where: { targetId: f.f.media.id, kind: "acquire_release" },
          }),
        ).toBe(0);
        return;
      }
      const input = await f.select();
      if (phase === "reservation") await f.changeCatalog();
      const outcome = await f.activities.reconcileMediaIntent(input);
      if (phase === "reservation") {
        expect(outcome).toMatchObject({
          status: "blocked",
          reason: "automatic_identity_changed",
        });
        expect(
          await db.acquisitionAttempt.count({
            where: { releaseId: f.release.id },
          }),
        ).toBe(0);
        return;
      }
      expect(outcome.status).toBe("acquire");
      const attemptId = z.uuid().parse(outcome.attemptId);
      const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      expect(
        AcquisitionIdentitySnapshotSchema.parse(attempt.identityEvidence).proof,
      ).toMatchObject({ kind: "automatic", basis: "title_year" });
      if (phase === "submission") {
        await f.changeCatalog();
        expect(
          await f.activities.submitMediaTorrent({ ...input, attemptId }),
        ).toMatchObject({
          status: "blocked",
          reason: "identity_mapping_changed",
        });
        expect(
          await db.torrent.count({
            where: { attempts: { some: { id: attemptId } } },
          }),
        ).toBe(0);
      }
      const currentRelease = await db.releaseCandidate.findUniqueOrThrow({
        where: { id: f.release.id },
      });
      expect(currentRelease.attributes).toEqual(f.release.attributes);
    } finally {
      await rm(f.f.directory, { recursive: true, force: true });
    }
  },
);

test("legacy canonical IMDb conflicts protect search, owner preview and automatic selection", async () => {
  const f = await automaticFixture("conflict");
  try {
    expect(
      await f.service.identityPreview(f.actor, f.f.media.id, f.release.id, {
        mediaIds: [f.f.media.id],
      }),
    ).toMatchObject({
      confirmationAllowed: false,
      identityReasons: ["external_identity_conflict"],
    });
    await expect(f.select()).rejects.toMatchObject({
      code: "external_identity_conflict",
    });
    expect(
      await database().acquisitionAttempt.count({
        where: { releaseId: f.release.id },
      }),
    ).toBe(0);
  } finally {
    await rm(f.f.directory, { recursive: true, force: true });
  }
});

test("a verified provider-field reference can match the existing canonical legacy namespace", async () => {
  const f = await automaticFixture("match");
  try {
    const result = await f.activities.reconcileMediaIntent(await f.select());
    expect(result.status).toBe("acquire");
    const attempt = await database().acquisitionAttempt.findUniqueOrThrow({
      where: { id: z.uuid().parse(result.attemptId) },
    });
    expect(
      AcquisitionIdentitySnapshotSchema.parse(attempt.identityEvidence).proof,
    ).toMatchObject({
      kind: "automatic",
      basis: "strong_reference",
      references: [{ kind: "movie", namespace: "imdb", value: "tt1111111" }],
    });
  } finally {
    await rm(f.f.directory, { recursive: true, force: true });
  }
});
