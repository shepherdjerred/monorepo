import { createHash } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { afterAll } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { currentSubtitleWork } from "#automation/subtitles/authority.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { SubtitleMatchScoreV1Schema } from "#shared/subtitle-maintenance/score.ts";
import { SubtitleMaintenanceJobV1Schema } from "#shared/subtitle-maintenance/activities.ts";
import { automaticSubtitleReplacementV1 } from "./replacement.ts";
import { claimSubtitleDownload } from "#automation/subtitle-sources.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export function automaticSubtitleHarness() {
  const harness = automationTestHarness();
  const ownerAccountId = crypto.randomUUID();
  const directories: string[] = [];
  afterAll(async () => {
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  });
  return {
    async setup(
      claimMode: "native" | "missing-event" = "native",
      mapped = false,
    ) {
      const db = harness.database();
      const f = await (mapped ? mappedPublicationFixture(db) : fileFixture(db));
      directories.push(f.directory);
      const published = await (mapped
        ? preparePhysicalPublication(f)
        : f.published());
      const asset = await db.libraryAsset.findUniqueOrThrow({
        where: { id: published.entry.assetId },
      });
      const owner = await db.mediaUser.upsert({
        where: { plexAccountId: ownerAccountId },
        create: {
          plexAccountId: ownerAccountId,
          displayName: "Owner",
          role: "owner",
        },
        update: {},
      });
      await db.mediaRequest.update({
        where: { id: f.request.id },
        data: { subtitleLanguages: ["en"] },
      });
      const work = await currentSubtitleWork(db, asset.id, 0);
      const score = SubtitleMatchScoreV1Schema.parse({
        schemaVersion: 1,
        weights: "bazarr-1.6.2",
        matcher: "media-evidence-v1",
        kind: "movie",
        score: 130,
        maximum: 180,
        matches: ["title", "year", "source"],
        referenceHash: "a".repeat(64),
        catalogStatus: "confirmed",
      });
      const next = SubtitleMatchScoreV1Schema.parse({
        ...score,
        score: 148,
        matches: [
          ...score.matches,
          "release_group",
          "resolution",
          "video_codec",
          "hearing_impaired",
        ],
      });
      const oldText = "1\n00:00:01,000 --> 00:00:03,000\nOriginal dialogue.\n";
      const newText = "1\n00:00:01,000 --> 00:00:03,000\nCorrected dialogue.\n";
      const path = subtitleDestination({
        videoPath: asset.path,
        language: "en",
        forced: false,
        hearingImpaired: false,
        format: "srt",
      });
      await writeFile(workerFilePath(f.context, path), oldText);
      const common = {
        assetId: asset.id,
        language: "en",
        qualityStatus: "accepted" as const,
        storageKind: "sidecar" as const,
        ownershipEpoch: 0,
        videoChecksum: asset.checksum,
        videoVersion: asset.version,
        forced: false,
        hearingImpaired: false,
      };
      const old = await db.subtitleAsset.create({
        data: {
          ...common,
          providerId: "manual",
          state: "installed",
          path,
          checksum: digest(oldText),
          provenance: { format: "srt", source: "manual" },
          matchingEvidence: {
            targetAuthority: work.authority,
            matchScoreV1: score,
          },
        },
      });
      const operationId = crypto.randomUUID();
      const downloadEventId = crypto.randomUUID();
      const requestedAt = new Date().toISOString();
      const job = SubtitleMaintenanceJobV1Schema.parse({
        operationId,
        assetId: asset.id,
        language: "en",
        forced: false,
        hearingImpaired: "any",
        recoveryEpoch: 0,
        targetAuthority: work.authority,
        upgradeV1: {
          oldSubtitleId: old.id,
          oldVersion: old.version,
          oldChecksum: old.checksum,
          minimumScore: score,
        },
      });
      await db.operation.create({
        data: {
          id: operationId,
          kind: "acquire_subtitles",
          targetId: asset.id,
          payload: z.record(z.string(), z.json()).parse(job),
          ...(claimMode === "native"
            ? {}
            : {
                result: {
                  subtitleDownload: {
                    eventId: downloadEventId,
                    requestedAt,
                    providerId: "subf2m",
                    candidateId: "/subtitles/example/english/123",
                  },
                },
              }),
        },
      });
      if (claimMode === "native")
        await claimSubtitleDownload(
          { db },
          {
            operationId,
            sourceFilename: "Example.mkv",
            query: "Example",
            language: "en",
          },
          "subf2m",
          "/subtitles/example/english/123",
        );
      const candidate = await db.subtitleAsset.create({
        data: {
          ...common,
          providerId: "subf2m",
          state: "validated",
          content: Buffer.from(newText),
          checksum: digest(newText),
          provenance: {
            filename: "Example.srt",
            description: "Synthetic human-caption provider response",
            format: "srt",
            checksum: digest(newText),
          },
          matchingEvidence: {
            operationId,
            targetAuthority: work.authority,
            matchScoreV1: next,
          },
        },
      });
      const network = {
        ...harness.context(),
        describeWorkflow: () =>
          Promise.resolve({
            status: "COMPLETED" as const,
            runId: crypto.randomUUID(),
          }),
      };
      const automatic = automaticSubtitleReplacementV1(network, () =>
        Promise.resolve(true),
      );
      f.context.enabled.subtitleMaintenance = () => Promise.resolve(true);
      return {
        ...f,
        db,
        owner,
        asset,
        old,
        candidate,
        job,
        automatic,
        oldText,
        newText,
        path,
        initialPublication: published,
        network,
      };
    },
  };
}
