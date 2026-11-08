import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { testWatchExecution } from "#testing/watch-execution.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { compensationPlayback } from "#infrastructure/native-compensation/playback.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { lockWatchAuthority } from "#automation/plex-events/authority.ts";
import { captureWatchBindingScope } from "#automation/plex-events/binding.ts";
import {
  NativeCompensationVerifiedPublicationSchema,
  type NativeCompensationActivityInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import {
  nativeCompensationFixture,
  testCompensationExecution,
} from "./test-fixture.ts";
import { reconcileCompensationHousehold } from "./fixtures/household.ts";
import { publishCompensatedMedia } from "./publication.ts";
import { compensationPublicationContext } from "./fixtures/publication.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>>;
let input: NativeCompensationActivityInput;
let directory: string | undefined;
let negativeId: string;
const requests: string[] = [];

beforeAll(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
    {
      stopAt: "sidecar_link",
      fileFactory: () =>
        sharedTvFileFixture(harness.database(), mappedPublicationFixture),
    },
  );
  directory = fixture.file.directory;
  await fixture.prepare();
  input = await fixture.apply();
  await fixture.observe(input);
  expect(
    await fixture.activities.compensateNativePublicationFiles(input),
  ).toEqual({ status: "compensated", reason: null });
  negativeId = z.uuid().parse(fixture.published.entry.mediaIds[1]);
}, 60_000);
afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

function publicationContext() {
  return compensationPublicationContext(
    harness.context(),
    fixture.observerContext,
    { requests },
  );
}

describe(
  "shared compensated publication",
  { concurrent: false, shuffle: false },
  () => {
    test("actual negative leaf reconciliation leaves the whole shared video held from playback", async () => {
      const db = harness.database();
      const mediaIds = fixture.published.entry.mediaIds;
      expect(mediaIds).toHaveLength(2);
      const reviewed = await reconcileCompensationHousehold(db, {
        owner: fixture.prior.actor,
        requester: fixture.file.user,
        mediaIds,
        negativeMediaIds: [negativeId],
        kind: "episode",
        serverMachineId: "server",
      });
      expect(
        reviewed.initial.scope.media.map((item) => item.id).toSorted(),
      ).toEqual(mediaIds.toSorted());
      const row =
        await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: input.continuationId },
        });
      expect(row.publicationCoordinatorOperationId).toBeNull();
      expect(row.fenceRelease).toBeNull();
      for (const id of mediaIds) {
        const media = await db.mediaItem.findUniqueOrThrow({ where: { id } });
        expect(media.availability).toBe("importing");
        expect(
          await db.$transaction((tx) =>
            compensationPlayback(tx, {
              mediaId: id,
              recoveryEpoch: input.recoveryEpoch,
              serverMachineId: "server",
              externalIds: media.externalIds,
            }),
          ),
        ).toEqual({ state: "protected" });
      }
      expect(requests).toEqual([]);
    });

    test("a fresh positive request verifies both Plex leaves and releases only the current compensation fence", async () => {
      const db = harness.database();
      const before = await db.libraryAsset.findUniqueOrThrow({
        where: { id: fixture.asset.id },
      });
      const historical = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: fixture.interrupted.attempt.id },
      });
      const commands = new PrismaMediaCommands(db, {
        keepDays: 30,
        serverMachineId: "server",
      });
      const requested = await commands.createRequest(
        fixture.file.user,
        crypto.randomUUID(),
        { mediaId: negativeId, subtitleLanguages: [], includeSpecials: false },
      );
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: z.uuid().parse(requested.operationId) },
      });
      expect(operation.kind).toBe("publish_compensated_media");
      const activity: NativeCompensationActivityInput = {
        ...input,
        operationId: operation.id,
      };
      const context = publicationContext();
      expect(
        await publishCompensatedMedia(
          context,
          activity,
          testCompensationExecution(),
        ),
      ).toEqual({ status: "available", reason: null });
      const row =
        await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
          where: { id: input.continuationId },
        });
      const proof = NativeCompensationVerifiedPublicationSchema.parse(
        row.verifiedPublication,
      );
      expect(proof.items.map((item) => item.mediaId).toSorted()).toEqual(
        fixture.published.entry.mediaIds.toSorted(),
      );
      expect(row.fenceRelease).not.toBeNull();
      const committed = await db.$transaction(async (tx) => ({
        continuation:
          await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
            where: { id: input.continuationId },
          }),
        bindings: await readCurrentPlexBindings(
          tx,
          fixture.published.entry.mediaIds.map((mediaId) => ({
            scope: { mediaId, edition: "default" },
            assetId: before.id,
            access: {
              serverMachineId: "server",
              sectionType: "show",
              sectionId: "2",
            },
          })),
        ),
      }));
      expect(committed.continuation.verifiedPublication).toEqual(
        row.verifiedPublication,
      );
      expect(committed.continuation.fenceRelease).toEqual(row.fenceRelease);
      expect(committed.bindings).toHaveLength(2);
      for (const binding of committed.bindings) {
        expect(binding.status).toBe("current");
        if (binding.status !== "current")
          throw new Error("Compensated leaf lacks committed serving binding");
        expect(proof.items).toContainEqual(
          expect.objectContaining({
            mediaId: binding.association.scope.mediaId,
            assetId: binding.association.group.assetId,
            ratingKey: binding.association.item.ratingKey,
          }),
        );
      }
      expect(requests.filter((item) => item.endsWith("/refresh"))).toEqual([
        "/library/sections/2/refresh",
      ]);
      const current = await db.libraryAsset.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(current.plexPublishedAt).toEqual(before.plexPublishedAt);
      expect(current.rollbackExpiresAt).toEqual(before.rollbackExpiresAt);
      expect(
        await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: historical.id },
        }),
      ).toEqual(historical);
      for (const mediaId of fixture.published.entry.mediaIds) {
        const bindingScope = await captureWatchBindingScope(db, mediaId, {
          serverMachineId: "server",
          sectionId: "2",
          sectionType: "show",
        });
        const authority = await db.$transaction((tx) =>
          lockWatchAuthority(
            tx,
            {
              mediaId,
              serverMachineId: "server",
              sections: { movie: "1", series: "2" },
              bindingScope,
            },
            testWatchExecution(),
          ),
        );
        expect(authority?.media.availability).toBe("available");
        expect(authority?.signature).toContain("compensationPublicationHash");
      }
      const networkCount = requests.length;
      expect(
        await publishCompensatedMedia(
          context,
          activity,
          testCompensationExecution(),
        ),
      ).toEqual({ status: "available", reason: null });
      expect(requests).toHaveLength(networkCount);
    });
  },
);
