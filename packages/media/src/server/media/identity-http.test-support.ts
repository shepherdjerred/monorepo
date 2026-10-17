import { expect } from "vitest";
import { rm } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { createMediaApp, type MediaAppDependencies } from "#server/app.ts";
import { IdentityPreviewSchema } from "#shared/acquisition/preview.ts";

export async function verifyIdentityHttp(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
) {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  const f = await fileFixture(db);
  try {
    const actor = await db.mediaUser.update({
      where: { id: f.user.id },
      data: { role: "owner" },
    });
    await db.plexIdentityMapping.create({
      data: {
        userId: actor.id,
        serverMachineId: "server",
        serverAccountId: actor.plexAccountId,
        kind: "account",
        permittedSectionIds: ["1"],
        permittedMediaKinds: ["movie"],
        verifiedAt: new Date(),
      },
    });
    await db.mediaItem.update({
      where: { id: f.media.id },
      data: { externalIds: { plexSectionId: "1" } },
    });
    const release = await db.releaseCandidate.create({
      data: {
        providerId: "knaben",
        providerReleaseId: crypto.randomUUID(),
        title: "Test.Film.1080p.WEB-DL.H264.ENG",
        mediaIds: [],
        searchedForMediaIds: [f.media.id],
        sourceEvidence: { infoHash: "c".repeat(40) },
        attributes: {
          mediaIds: [],
          identityConfidence: "ambiguous",
          quality: "WEB-1080p",
          codec: "H264",
          audioLanguages: ["en"],
          sizeBytes: 20,
          scoreTags: [],
        },
        evaluation: {
          accepted: false,
          qualityRank: 0,
          score: 0,
          reasons: ["identity_unconfirmed"],
        },
      },
    });
    dependencies.auth.authenticate = () =>
      Promise.resolve({ actor, csrfHash: "csrf-hash" });
    dependencies.media = new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId: "server",
    });
    const app = createMediaApp(dependencies);
    const previewUrl = `/api/v1/media/${f.media.id}/releases/${release.id}/identity-preview`;
    const response = await app.request(previewUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaIds: [f.media.id] }),
    });
    expect(response.status).toBe(200);
    const preview = IdentityPreviewSchema.parse(await response.json());
    const input = {
      action: "select_release",
      releaseId: release.id,
      expectedVersion: 0,
      identityConfirmation: {
        previewDigest: preview.previewDigest,
        candidateDigest: preview.candidateDigest,
        numberingDigest: null,
        mediaIds: [f.media.id],
        reason: "Owner confirms the exact canonical movie identity",
        acknowledgeIdentity: true,
      },
    };
    const forged = await app.request(`/api/v1/media/${f.media.id}/actions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...input,
        identityConfirmation: {
          ...input.identityConfirmation,
          actorId: actor.id,
        },
      }),
    });
    expect(forged.status).toBe(400);
    expect(await db.operation.count({ where: { targetId: f.media.id } })).toBe(
      0,
    );
    await db.plexIdentityMapping.update({
      where: { userId: actor.id },
      data: { permittedSectionIds: ["9"] },
    });
    const revokedPreview = await app.request(previewUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaIds: [f.media.id] }),
    });
    const revokedList = await app.request(
      `/api/v1/media/${f.media.id}/releases`,
      { headers },
    );
    const revokedAction = await app.request(
      `/api/v1/media/${f.media.id}/actions`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
    expect([
      revokedPreview.status,
      revokedList.status,
      revokedAction.status,
    ]).toEqual([403, 403, 403]);
    expect(await db.operation.count({ where: { targetId: f.media.id } })).toBe(
      0,
    );
    await db.plexIdentityMapping.update({
      where: { userId: actor.id },
      data: { permittedSectionIds: ["1"] },
    });
    const accepted = await app.request(`/api/v1/media/${f.media.id}/actions`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(accepted.status).toBe(202);
    const operation = await db.operation.findFirstOrThrow({
      where: { targetId: f.media.id },
    });
    expect(operation.payload).toMatchObject({
      identityDecision: {
        actorId: actor.id,
        releaseId: release.id,
        coverage: [f.media.id],
        recoveryEpoch: 0,
      },
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
    await cluster.close();
  }
}
