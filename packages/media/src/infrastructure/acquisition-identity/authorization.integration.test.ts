import { expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "./test-fixture.ts";
import { IdentityConfirmationSchema } from "#shared/acquisition/preview.ts";
import { reserveCandidate } from "#automation/acquisition-reservation.ts";
import { loadProfile } from "#automation/acquisition-candidates.ts";
import { buildCanonicalIdentity } from "./snapshot.ts";
import { lockAcquisitionMedia } from "./locks.ts";
import { PrismaNumberingAdministration } from "#infrastructure/numbering-admin.ts";

const { database, context } = automationTestHarness();
test.each(["restricted", "demoted", "section", "source"])(
  "review cannot authorize after %s drift",
  async (kind) => {
    const db = database();
    const f = await identityFixture(db, context());
    try {
      const preview = await f.review();
      const before = await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId: f.files.media.id },
      });
      if (kind === "restricted" || kind === "demoted")
        await db.mediaUser.update({
          where: { id: f.actor.id },
          data:
            kind === "restricted" ? { restricted: true } : { role: "member" },
        });
      if (kind === "section")
        await db.plexIdentityMapping.update({
          where: { userId: f.actor.id },
          data: { permittedSectionIds: ["9"] },
        });
      if (kind === "source")
        await db.releaseCandidate.update({
          where: { id: f.release.id },
          data: { sourceEvidence: { infoHash: "b".repeat(40) } },
        });
      await expect(
        f.service.act(f.actor, crypto.randomUUID(), f.files.media.id, {
          action: "select_release",
          releaseId: f.release.id,
          expectedVersion: preview.media[0]?.version ?? -1,
          identityConfirmation: {
            previewDigest: preview.previewDigest,
            candidateDigest: preview.candidateDigest,
            numberingDigest: preview.numberingDigest,
            mediaIds: [f.files.media.id],
            reason: "Explicit owner review for this release",
            acknowledgeIdentity: true,
          },
        }),
      ).rejects.toThrow();
      expect(
        await db.mediaIntent.findUniqueOrThrow({
          where: { mediaId: f.files.media.id },
        }),
      ).toEqual(before);
      expect(
        await db.operation.count({
          where: { kind: "acquire_release", targetId: f.files.media.id },
        }),
      ).toBe(0);
    } finally {
      await rm(f.files.directory, { recursive: true, force: true });
    }
  },
);

test("season pack cannot authorize one leaf of twelve through owner or automatic reservation", async () => {
  const db = database();
  const f = await identityFixture(db, context());
  try {
    for (let episode = 2; episode <= 12; episode++)
      await db.mediaItem.create({
        data: {
          kind: "episode",
          parentId: f.series.id,
          title: `Episode ${String(episode)}`,
          seasonNumber: 1,
          episodeNumber: episode,
        },
      });
    await db.releaseCandidate.update({
      where: { id: f.release.id },
      data: { title: "Example.Show.S01.1080p.WEB-DL.H264.ENG" },
    });
    expect(await f.review()).toMatchObject({
      confirmationAllowed: false,
      identityReasons: expect.arrayContaining(["season_pack_incomplete"]),
    });
    const attrs = z.record(z.string(), z.json()).parse(f.release.attributes);
    await db.releaseCandidate.update({
      where: { id: f.release.id },
      data: {
        mediaIds: [f.files.media.id],
        attributes: {
          ...attrs,
          mediaIds: [f.files.media.id],
          identityConfidence: "exact",
        },
      },
    });
    const intent = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId: f.files.media.id },
    });
    const operation = await db.operation.create({
      data: {
        kind: "acquire_release",
        targetId: f.files.media.id,
        payload: {},
      },
    });
    const profile = await loadProfile(db, f.files.media.id);
    if (profile === null) throw new Error("Missing fixture profile");
    await expect(
      reserveCandidate(
        f.network,
        {
          operationId: operation.id,
          mediaId: f.files.media.id,
          generation: intent.generation,
        },
        { releaseId: f.release.id, profile, epoch: 0 },
      ),
    ).rejects.toMatchObject({ code: "season_pack_incomplete" });
    expect(
      await db.acquisitionAttempt.count({ where: { releaseId: f.release.id } }),
    ).toBe(0);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test("identity source and operation evidence are insert-only, including historical nulls", async () => {
  const db = database();
  const f = await identityFixture(db, context());
  try {
    const acquired = await f.acquire();
    await expect(
      db.acquisitionAttempt.update({
        where: { id: acquired.attempt.id },
        data: { identityEvidence: {} },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      db.operation.update({
        where: { id: acquired.operation.operationId },
        data: { payload: {} },
      }),
    ).rejects.toThrow("immutable");
    const historical = await db.acquisitionAttempt.create({
      data: {
        releaseId: f.release.id,
        sponsorRequestId: acquired.attempt.sponsorRequestId,
        mediaIds: [],
        generations: {},
        state: "cancelled",
        operationId: crypto.randomUUID(),
      },
    });
    await expect(
      db.acquisitionAttempt.update({
        where: { id: historical.id },
        data: { identityEvidence: {} },
      }),
    ).rejects.toThrow("immutable");
    const oldOperation = await db.operation.create({
      data: { kind: "acquire_release", payload: {} },
    });
    await expect(
      db.operation.update({
        where: { id: oldOperation.id },
        data: { payload: { identityDecision: {} } },
      }),
    ).rejects.toThrow("immutable");
    expect(
      IdentityConfirmationSchema.safeParse({ actorId: f.actor.id }).success,
    ).toBe(false);
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});

test("snapshot before numbering writer commit cannot pass stale sibling duplicate evidence", async () => {
  const db = database();
  const f = await identityFixture(db, context(), true);
  try {
    const sibling = await db.mediaItem.create({
      data: {
        kind: "episode",
        parentId: f.series.id,
        title: "Second",
        seasonNumber: 1,
        episodeNumber: 2,
      },
    });
    let releaseReader: () => void = () => {
      throw new Error("Reader latch uninitialized");
    };
    let readStarted: () => void = () => {
      throw new Error("Started latch uninitialized");
    };
    const wait = new Promise<void>((resolve) => {
      releaseReader = resolve;
    });
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const reader = db.$transaction(
      async (tx) => {
        await tx.mediaItem.findUniqueOrThrow({ where: { id: f.series.id } });
        readStarted();
        await wait;
        await lockAcquisitionMedia(tx, [f.files.media.id]);
        return buildCanonicalIdentity(tx, [f.files.media.id]);
      },
      { isolationLevel: "Serializable" },
    );
    const outcome = (async () => {
      try {
        await reader;
        return "accepted";
      } catch {
        return "serialization_rejected";
      }
    })();
    await started;
    await new PrismaNumberingAdministration(db).save(
      f.actor,
      crypto.randomUUID(),
      sibling.id,
      {
        expectedVersion: 0,
        absoluteNumber: 124,
        evidence: "Owner verified second canonical absolute episode",
      },
    );
    releaseReader();
    expect(await outcome).toBe("serialization_rejected");
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
});
