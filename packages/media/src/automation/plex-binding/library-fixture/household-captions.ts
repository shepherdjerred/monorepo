import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaMigrationAdministration } from "#migration/persistence.ts";
import type { MigrationRecord, MigrationReport } from "#shared/migration.ts";
import { SubtitleSourceProfileSchema } from "#shared/migration-subtitles.ts";
import { captureFixture } from "#migration/bundle-test-fixtures.ts";
import { snapshotHash } from "#migration/profile-import.ts";

/** Genuine Bazarr capture bound by owner declaration to the actual manager instance. */
export async function uploadHouseholdCaptions(input: {
  administration: PrismaMigrationAdministration;
  actor: MediaActor;
  enabled: boolean;
  kind: "movies" | "tv";
  media: MigrationRecord[];
  sourceInstanceId: string;
}) {
  if (!input.enabled) return;
  const root = input.media.find(
    (item) =>
      item.kind === "media" &&
      item.mediaKind === (input.kind === "movies" ? "movie" : "series") &&
      item.parentSourceId === null,
  );
  if (root?.kind !== "media")
    throw new Error("Household caption policy needs its actual root capture");
  return input.administration.upload(input.actor, {
    snapshot: captureFixture("bazarr", [
      {
        kind: "subtitle_preference",
        sourceId: "household-caption-policy",
        mediaSourceId: root.sourceId,
        languages: ["en", "zh"],
        forced: false,
        hearingImpaired: false,
        managerReference: {
          kind: input.kind === "movies" ? "radarr" : "sonarr",
          sourceMediaId: root.sourceId,
          sourceInstanceId: input.sourceInstanceId,
          binding: "owner_declared",
        },
        sourceProfile: SubtitleSourceProfileSchema.parse({
          profileId: 7,
          cutoff: null,
          originalFormat: 0,
          hasConstraints: false,
          constraintHash: snapshotHash([]),
          items: ["en", "zh"].map((language, index) => ({
            id: index + 1,
            language,
            forced: "False",
            hi: "False",
            audio_exclude: "False",
            audio_only_include: "False",
          })),
        }),
      },
    ]),
  });
}

export async function householdCaptionSelection(
  db: Database,
  entries: MigrationReport["entries"],
  enabled: boolean,
) {
  if (!enabled) return [];
  return Promise.all(
    entries
      .filter((entry) => entry.kind === "subtitle_preference")
      .map(async (entry) => {
        const mediaId = z.uuid().parse(entry.mediaIds[0]);
        if (entry.mediaIds.length !== 1)
          throw new Error("Expected one actual root policy");
        const latest = await db.mediaSubtitlePolicyVersion.findFirst({
          where: { mediaId, edition: "default" },
          orderBy: { version: "desc" },
        });
        return {
          provenanceKey: entry.provenanceKey,
          expectedPolicyVersion: latest?.version ?? -1,
          chinese: "require_simplified" as const,
        };
      }),
  );
}
