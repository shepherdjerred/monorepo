import { rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  personalSeasonFixture,
  changePersonalSeasonAuthority,
  PersonalSeasonOperation as Operation,
} from "./fixtures/personal-season.ts";

const h = automationTestHarness();
async function retainedSeason() {
  const f = await personalSeasonFixture(h.database(), h.context());
  const { db, network, originalInput, birth, probe, physical, operation } = f;
  expect(await physical.inspectAndStageMedia(originalInput)).toEqual({
    status: "staged",
  });
  const retained = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: birth.id },
  });
  const plan = FilePlanSchema.parse(retained.filePlan);
  expect(plan).toHaveLength(10);
  await createOutboxActivities(db, () =>
    Promise.reject(new Error("No workflow transport needed")),
  ).finishMediaOperation({
    operationId: operation.id,
    status: "reconciling",
    reason: "publication_authority_expired",
  });
  const beforeRetry = await f.service.getDefaultCommandContext(
    f.actor,
    f.files.media.id,
  );
  const retried = await f.service.executeDefaultCommand(
    f.actor,
    crypto.randomUUID(),
    {
      schemaVersion: 2,
      scope: beforeRetry.scope,
      expected: beforeRetry.expected,
      command: { action: "retry" },
    },
  );
  const retryOperation = await db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(retried.result.operationId) },
  });
  expect(
    await network.reconcileMediaIntent(Operation.parse(retryOperation.payload)),
  ).toMatchObject({
    status: "acquire",
    attemptId: birth.id,
    reason: "resume_existing_acquisition",
  });
  const current = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: birth.id },
  });
  expect(current.generations).not.toEqual(retained.generations);
  expect(current.identityEvidence).toEqual(birth.identityEvidence);
  expect(current.torrentId).toBe(birth.torrentId);
  expect(current.filePlan).toEqual(retained.filePlan);
  const input = { attemptId: birth.id, operationId: retryOperation.id };
  expect(await physical.inspectAndStageMedia(input)).toEqual({
    status: "staged",
  });
  expect(probe).toHaveBeenCalledTimes(10);
  return { ...f, db, birth, retained, plan, current, input, physical };
}

test("normal v2 owner Retry publishes the same ten-file TV birth and immutable plan after real generation renewal", async () => {
  const f = await retainedSeason();
  try {
    expect(await f.physical.promoteMediaFiles(f.input)).toEqual({
      status: "published",
    });
    const final = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    });
    expect(identityHash(final.filePlan)).toBe(
      identityHash(f.retained.filePlan),
    );
    expect(final.identityEvidence).toEqual(f.birth.identityEvidence);
    expect(final.torrentId).toBe(f.birth.torrentId);
    expect(final.operationId).toBe(f.birth.operationId);
    expect(final.sponsorRequestId).toBe(f.birth.sponsorRequestId);
    expect(await f.db.acquisitionAttempt.count()).toBe(1);
    expect(await f.db.torrent.count()).toBe(1);
    expect(f.adds()).toBe(1);
    expect(
      await f.db.libraryAsset.count({
        where: { torrentId: final.torrentId, state: "published" },
      }),
    ).toBe(10);
    expect(await f.db.assetCoverage.count({ where: { current: true } })).toBe(
      10,
    );
  } finally {
    await rm(f.files.directory, { recursive: true, force: true });
  }
}, 60_000);

test.each(["intent", "profile", "reservation", "request", "runtime"] as const)(
  "renewed TV publication still rejects changed %s authority before forward effects",
  async (change) => {
    const f = await retainedSeason();
    try {
      switch (change) {
        case "intent": {
          const view = await f.service.getDefaultCommandContext(
            f.actor,
            f.files.media.id,
          );
          // A second real command advances the intent without adopting this attempt.
          await f.service.executeDefaultCommand(f.actor, crypto.randomUUID(), {
            schemaVersion: 2,
            scope: view.scope,
            expected: view.expected,
            command: { action: "retry" },
          });
          break;
        }
        case "profile":
        case "reservation":
        case "request":
        case "runtime":
          await changePersonalSeasonAuthority(f, change);
          break;
      }
      expect(await f.physical.promoteMediaFiles(f.input)).toMatchObject({
        status: change === "runtime" ? "blocked" : "obsolete",
        reason:
          change === "intent"
            ? "intent_obsolete"
            : change === "profile"
              ? "profile_obsolete"
              : change === "reservation"
                ? "reservation_obsolete"
                : change === "request"
                  ? "request_obsolete"
                  : "runtime_protected",
      });
      expect(
        await f.db.libraryAsset.count({
          where: { torrentId: f.birth.torrentId },
        }),
      ).toBe(0);
      expect(
        await f.db.assetCoverage.count({
          where: { mediaId: { in: f.birth.mediaIds } },
        }),
      ).toBe(0);
      expect(
        await f.db.mediaPublicationTransition.count({
          where: { attemptId: f.birth.id },
        }),
      ).toBe(0);
      const final = await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.birth.id },
      });
      expect(final.filePlan).toEqual(f.retained.filePlan);
      expect(final.identityEvidence).toEqual(f.birth.identityEvidence);
      expect(final.torrentId).toBe(f.birth.torrentId);
      expect(f.adds()).toBe(1);
    } finally {
      await rm(f.files.directory, { recursive: true, force: true });
    }
  },
  60_000,
);
