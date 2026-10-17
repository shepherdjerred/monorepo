import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "./test-fixture.ts";
import { AcquisitionIdentitySnapshotSchema } from "#shared/acquisition/identity.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { createAcquisitionActivities } from "#automation/acquisition.ts";

const { database, context } = automationTestHarness();

test.each([false, true])(
  "actual owner review selects yearless release and submits immutable identity (absolute=%s)",
  async (absolute) => {
    const f = await identityFixture(database(), context(), absolute);
    try {
      const preview = await f.review();
      expect(preview.confirmationAllowed).toBe(true);
      expect(preview.canonicalTitle).toBe("Example Show");
      const acquired = await f.acquire();
      expect(
        AcquisitionIdentitySnapshotSchema.parse(
          acquired.attempt.identityEvidence,
        ),
      ).toMatchObject({
        proof: { kind: "owner" },
        coverage: [f.files.media.id],
        birthEpoch: 0,
      });

      expect(f.adds()).toBe(1);
      const activities = createMediaFileActivities(f.files.context);
      expect(
        await activities.inspectAndStageMedia(acquired.input),
      ).toMatchObject({ status: "staged" });
      expect(await activities.promoteMediaFiles(acquired.input)).toMatchObject({
        status: "published",
      });
    } finally {
      await rm(f.files.directory, { recursive: true, force: true });
    }
  },
);

test("owner identity confirmation cannot waive audio/quality or conflicting strong IDs", async () => {
  const db = database();
  const f = await identityFixture(db, context());
  try {
    const rules = z.record(z.string(), z.json()).parse(f.files.profile.rules);
    await db.qualityProfile.update({
      where: { id: f.files.profile.id },
      data: { rules: { ...rules, requiredAudioLanguages: ["fr"] } },
    });
    const quality = await f.review();
    expect(quality.confirmationAllowed).toBe(false);
    expect(quality.qualityBlockers.length).toBeGreaterThan(0);
    await expect(f.select()).rejects.toMatchObject({
      code: "identity_protected",
    });
    await db.qualityProfile.update({
      where: { id: f.files.profile.id },
      data: { rules },
    });
    await db.releaseCandidate.update({
      where: { id: f.release.id },
      data: {
        sourceEvidence: {
          infoHash: f.source.infoHash,
          references: [
            {
              kind: "series",
              namespace: "tmdb",
              value: "999999999999",
              provenance: {
                kind: "provider-field",
                field: "fixture_catalog_id",
              },
            },
          ],
        },
      },
    });
    expect(await f.review()).toMatchObject({
      confirmationAllowed: false,
      identityReasons: ["external_identity_conflict"],
    });
    expect(
      await db.acquisitionAttempt.count({
        where: { releaseId: f.release.id },
      }),
    ).toBe(0);
    expect(f.adds()).toBe(0);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test("same identity Retry advances live generations without rebirthing immutable decision or attempt", async () => {
  const db = database();
  const f = await identityFixture(db, context(), true);
  try {
    const acquired = await f.acquire();
    await db.operation.update({
      where: { id: acquired.operation.operationId },
      data: { status: "failed" },
    });
    const current = await db.mediaItem.findUniqueOrThrow({
      where: { id: f.files.media.id },
    });
    const retry = await f.service.act(
      f.actor,
      crypto.randomUUID(),
      current.id,
      { action: "retry", expectedVersion: current.version },
    );
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(retry.operationId) },
    });
    const input = z
      .object({
        operationId: z.uuid(),
        mediaId: z.uuid(),
        generation: z.number().int(),
      })
      .parse(operation.payload);
    expect(
      await createAcquisitionActivities(f.network).reconcileMediaIntent(input),
    ).toMatchObject({
      status: "acquire",
      attemptId: acquired.attempt.id,
    });
    const resumed = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    expect(resumed.identityEvidence).toEqual(acquired.attempt.identityEvidence);
    expect(resumed.recoveryEpoch).toBe(acquired.attempt.recoveryEpoch);
    expect(resumed.generations).toMatchObject({
      [current.id]: input.generation,
    });
    expect(f.adds()).toBe(1);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});
