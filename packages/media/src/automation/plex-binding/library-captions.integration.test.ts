import { afterEach, beforeAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { currentMovieSubtitlePolicies } from "#infrastructure/movie-editions/subtitle-policy.ts";
import { policyStatus } from "#infrastructure/subtitle-policy.ts";
import { readMovieSubtitleReceiptV4 } from "#infrastructure/movie-editions/subtitle-receipt.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { subtitleTargetsReady } from "#automation/subtitles/authority.ts";
import { findMovieSubtitlesV4 } from "#automation/movie-editions/subtitles/network.ts";
import { installMovieSubtitlesV4 } from "#automation/files/movie-editions/subtitles.ts";
import { captionProviderFixture } from "#automation/movie-editions/notifications/caption-provider.test-fixture.ts";
import { libraryBindingFixture } from "./library.test-fixture.ts";
import { verifyLibraryPlexBinding } from "./library.ts";

const h = automationTestHarness();
const directories: string[] = [];
const downloadOperations: string[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
  const operations = downloadOperations.splice(0);
  if (operations.length > 0)
    await h.database().applicationEvent.deleteMany({
      where: {
        kind: "subtitle_download_requested",
        OR: operations.map((operationId) => ({
          payload: { path: ["operationId"], equals: operationId },
        })),
      },
    });
});

type Fixture = Awaited<ReturnType<typeof libraryBindingFixture>>;
function scope(f: Fixture) {
  return {
    rootMediaId: f.network.media.id,
    mediaId: f.network.media.id,
    edition: MovieEditionKeySchema.parse(f.asset.edition),
  };
}
async function bindingInput(f: Fixture) {
  const command = await h.database().operation.findUniqueOrThrow({
    where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
  });
  return LibraryPlexBindingInputV1Schema.parse(command.payload);
}
async function captionCommands(f: Fixture) {
  return h.database().operation.findMany({
    where: { kind: "acquire_movie_subtitles_v4", targetId: f.asset.id },
    orderBy: { id: "asc" },
    include: { outbox: true },
  });
}
async function immutableAdoption(f: Fixture) {
  const receipt = await h.database().mediaHandoffReceipt.findUniqueOrThrow({
    where: { id: f.receiptId },
  });
  return {
    receipt,
    plan: await h.database().mediaHandoffPlan.findUniqueOrThrow({
      where: { id: receipt.planId },
    }),
    review: await h.database().migrationBundleReview.findUniqueOrThrow({
      where: { id: f.reviewId },
    }),
    video: createHash("sha256")
      .update(await readFile(f.target))
      .digest("hex"),
    item: f.item(),
  };
}
async function currentBinding(f: Fixture) {
  return h.database().plexBindingCurrent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: scope(f).mediaId,
        edition: scope(f).edition,
      },
    },
  });
}
async function assertNoAcquisitionOrPersonalDemand(f: Fixture) {
  expect(
    await h
      .database()
      .mediaRequest.count({ where: { mediaId: scope(f).mediaId } }),
  ).toBe(0);
  expect(
    await h
      .database()
      .movieEditionChoice.count({ where: { rootMediaId: scope(f).mediaId } }),
  ).toBe(0);
  expect(
    await h.database().acquisitionAttempt.count({
      where: { mediaIds: { has: scope(f).mediaId } },
    }),
  ).toBe(0);
  expect(await h.database().torrent.count()).toBe(0);
}

test.each(
  MovieEditionKeySchema.options.filter((edition) => edition !== "default"),
)(
  "binding an adopted %s movie queues and installs its captured household captions without personal consent or a new video",
  async (edition) => {
    const f = await libraryBindingFixture(
      h.database(),
      edition,
      (directory) => directories.push(directory),
      { bytes, householdCaptions: true },
    );
    const baseline = await immutableAdoption(f);
    await assertNoAcquisitionOrPersonalDemand(f);
    expect(await captionCommands(f)).toHaveLength(0);
    const input = await bindingInput(f);
    expect(
      await verifyLibraryPlexBinding(
        f.context,
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "verified", bindingCount: 1 });
    const binding = await currentBinding(f);
    const video = await h
      .database()
      .libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } });
    const commands = await captionCommands(f);
    expect(commands).toHaveLength(2);
    const targets = commands.map((row) =>
      MovieSubtitleOperationV4Schema.parse(
        z.object(MovieSubtitleOperationV4Schema.shape).parse(row.payload),
      ),
    );
    expect(targets.map((target) => target.language).sort()).toEqual([
      "en",
      "zh-Hans",
    ]);
    for (const row of commands) {
      expect(row.outbox).toMatchObject({
        kind: "acquire_movie_subtitles_v4",
        payload: row.payload,
      });
    }
    const sources = await captionProviderFixture(f.context);
    for (const target of targets) {
      downloadOperations.push(target.operationId);
      await h
        .database()
        .providerLease.deleteMany({ where: { providerId: "opensubtitles" } });
      const found = await findMovieSubtitlesV4(f.context, target, sources);
      expect(found).toMatchObject({ status: "found", reason: null });
      const install = {
        schemaVersion: 4 as const,
        operationId: target.operationId,
        assetId: f.asset.id,
        scope: scope(f),
        subtitleId: z.uuid().parse(found.subtitleId),
      };
      await installMovieSubtitlesV4(f.files, install);
      expect(
        await readMovieSubtitleReceiptV4(
          h.database(),
          install,
          new PublicationAuthorityReadBudget(),
        ),
      ).toMatchObject({
        publication: {
          kind: "movie_library_adoption_v2",
          receiptId: f.receiptId,
        },
      });
    }
    const work = await currentMovieSubtitleWorkV4(
      h.database(),
      {
        scope: scope(f),
        assetId: f.asset.id,
        epoch: 0,
        access: { serverMachineId: "fixture-server", movieSectionId: "1" },
      },
      new PublicationAuthorityReadBudget(),
    );
    expect(work.protectedReasons).toEqual([]);
    expect(subtitleTargetsReady(work, 0)).toBe(true);
    const policies = await currentMovieSubtitlePolicies(
      h.database(),
      scope(f),
      new PublicationAuthorityReadBudget(),
    );
    expect(policies).toHaveLength(1);
    expect(
      policyStatus({ policy: policies[0], asset: work.asset, epoch: 0 }),
    ).toMatchObject({ satisfied: true, missing: [], protectedReasons: [] });
    expect(
      work.asset.subtitles.filter((subtitle) => subtitle.state === "installed"),
    ).toHaveLength(2);
    for (const subtitle of work.asset.subtitles.filter(
      (row) => row.state === "installed",
    )) {
      const content = await readFile(z.string().parse(subtitle.path));
      expect(createHash("sha256").update(content).digest("hex")).toBe(
        subtitle.checksum,
      );
      expect(content.byteLength).toBeGreaterThan(0);
    }
    expect(
      await h
        .database()
        .libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(video);
    expect(await currentBinding(f)).toEqual(binding);
    expect(await immutableAdoption(f)).toEqual(baseline);
    await assertNoAcquisitionOrPersonalDemand(f);
    const completedCommands = await captionCommands(f);
    expect(
      await verifyLibraryPlexBinding(
        f.context,
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "verified", bindingCount: 1 });
    expect(await captionCommands(f)).toEqual(completedCommands);
  },
  60_000,
);

test.each(["unmonitored", "revoked_owner"] as const)(
  "%s adoption binds the actual Plex item without granting named caption work",
  async (protection) => {
    const f = await libraryBindingFixture(
      h.database(),
      "directors_cut",
      (directory) => directories.push(directory),
      {
        bytes,
        householdCaptions: true,
        ...(protection === "unmonitored" ? { monitored: false } : {}),
      },
    );
    const baseline = await immutableAdoption(f);
    if (protection === "revoked_owner") {
      const observed = await authenticateMovieFixtureOwner(
        f.context,
        f.network.actor,
        { ownerAccountId: "710099" },
      );
      expect(observed.role).toBe("member");
    }
    const input = await bindingInput(f);
    expect(
      await verifyLibraryPlexBinding(
        f.context,
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "verified", bindingCount: 1 });
    const binding = await currentBinding(f);
    expect(binding.evidenceId).not.toBeNull();
    expect(await captionCommands(f)).toHaveLength(0);
    expect(await immutableAdoption(f)).toEqual(baseline);
    await assertNoAcquisitionOrPersonalDemand(f);
  },
  60_000,
);
