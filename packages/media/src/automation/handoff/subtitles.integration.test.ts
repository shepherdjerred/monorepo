import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { rm, writeFile, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { handoffFixture } from "./test-fixture.ts";
import { applyPreparedHandoff } from "./apply.ts";
import { prepareHandoffFiles } from "./files.ts";
import { projectHandoffSubtitles } from "#infrastructure/handoff/subtitles.ts";
import { HandoffScopeSchema } from "#shared/handoff.ts";
import {
  MigrationBundleSchema,
  BundleReportSchema,
} from "#shared/migration-handoff.ts";
import { SubtitleSourceProfileSchema } from "#shared/migration-subtitles.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture(
  options: {
    embedded?: boolean;
    wrongInstance?: boolean;
    policy?: boolean;
  } = {},
) {
  const value = await handoffFixture(cluster.database, {
    async extendReport({ report, manifest, target }) {
      directories.push(path.dirname(path.dirname(target)));
      const media = report.entries.find((item) => item.kind === "media");
      const manager = manifest.captures.find(
        (item) => item.sourceKind === "radarr",
      );
      if (media === undefined || manager === undefined)
        throw new Error("Missing synthetic manager");
      const captureHash = snapshotHash({ bazarr: target });
      manifest.captures.push({
        captureId: crypto.randomUUID(),
        captureHash,
        sourceKind: "bazarr",
        sourceInstanceId: snapshotHash("synthetic-bazarr"),
      });
      const sourceRecord = {
        kind: "subtitle" as const,
        sourceId: "radarr:subtitle1",
        mediaSourceId: "radarr:1",
        videoPath: "/movies/Film.mkv",
        path: options.embedded === true ? null : "/movies/Film.en.srt",
        embeddedTrackId: options.embedded === true ? 2 : null,
        language: "en",
        forced: false,
        hearingImpaired: false,
        checksum: null,
        provenance: "unknown" as const,
        managerReference: {
          kind: "radarr" as const,
          sourceMediaId: "1",
          sourceInstanceId:
            options.wrongInstance === true
              ? "f".repeat(64)
              : manager.sourceInstanceId,
          binding: "owner_declared" as const,
        },
      };
      report.entries.push({
        ...media,
        sourceRecord,
        sourceId: sourceRecord.sourceId,
        kind: "subtitle",
        captureHash,
        provenanceKey: snapshotHash({ subtitle: target }),
        observationHash: snapshotHash(sourceRecord),
      });
      if (options.policy === true) {
        const sourceProfile = SubtitleSourceProfileSchema.parse({
          profileId: 7,
          cutoff: null,
          originalFormat: 0,
          hasConstraints: false,
          constraintHash: snapshotHash([]),
          items: [false, true].map((forced, index) => ({
            id: index + 1,
            language: "en",
            forced: forced ? "True" : "False",
            hi: "False",
            audio_exclude: "False",
            audio_only_include: "False",
          })),
        });
        const preference = {
          kind: "subtitle_preference" as const,
          sourceId: "policy1",
          mediaSourceId: sourceRecord.mediaSourceId,
          languages: ["en"],
          forced: false,
          hearingImpaired: false,
          sourceProfile,
          managerReference: sourceRecord.managerReference,
        };
        report.entries.push({
          ...media,
          kind: preference.kind,
          sourceId: preference.sourceId,
          sourceRecord: preference,
          captureHash,
          provenanceKey: snapshotHash({ policy: target }),
          observationHash: snapshotHash(z.json().parse(preference)),
        });
      }
      await writeFile(
        path.join(path.dirname(target), "Film.en.srt"),
        "1\n00:00:01,000 --> 00:00:02,000\nLegacy caption\n",
      );
    },
  });
  return value;
}
test("owner-reviewed exact sidecar becomes owned but never quality-accepted; unknown neighbor stays protected", async () => {
  const f = await fixture();
  const neighbor = path.join(path.dirname(f.target), "Film.fr.srt");
  await writeFile(neighbor, "Unselected neighboring subtitle");
  const ready = await f.ready();
  await applyPreparedHandoff(f.context, ready.input, ready.prepared);
  const asset = await cluster.database.libraryAsset.findUniqueOrThrow({
    where: { path: f.target },
    include: { subtitles: true },
  });
  const subtitle = asset.subtitles[0];
  expect(subtitle).toMatchObject({
    state: "installed",
    qualityStatus: "unverified",
    ownershipEpoch: 0,
    storageKind: "sidecar",
    videoVersion: asset.version,
    videoChecksum: asset.checksum,
  });
  if (subtitle === undefined) throw new Error("Missing subtitle");
  expect(subtitleAccepted({ subtitle, asset, epoch: 0 })).toBe(false);
  expect(asset.properties).toMatchObject({ handoffSidecarsUnresolved: true });
  expect(await readFile(neighbor, "utf8")).toBe(
    "Unselected neighboring subtitle",
  );
  expect(
    await cluster.database.subtitleAsset.count({ where: { path: neighbor } }),
  ).toBe(0);
});
test("source regular and forced policy is versioned immutably and adoption does not satisfy it", async () => {
  const f = await fixture({ policy: true });
  const ready = await f.ready();
  await applyPreparedHandoff(f.context, ready.input, ready.prepared);
  const policy =
    await cluster.database.mediaSubtitlePolicyVersion.findFirstOrThrow({
      where: {
        mediaId: z.uuid().parse(ready.prepared.scope.media[0]?.mediaId),
      },
    });
  expect(policy.rules).toMatchObject({
    targets: [
      { language: "en", forced: false, hearingImpaired: "any" },
      { language: "en", forced: true, hearingImpaired: "excluded" },
    ],
  });
  const queued = await cluster.database.operation.findMany({
    where: { kind: "acquire_subtitles" },
  });
  expect(
    queued.map((operation) =>
      z
        .object({
          language: z.string(),
          forced: z.boolean(),
          targetAuthority: z.string(),
        })
        .parse(operation.payload),
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ language: "en", forced: false }),
      expect.objectContaining({ language: "en", forced: true }),
    ]),
  );
  await expect(
    cluster.database.mediaSubtitlePolicyVersion.update({
      where: { id: policy.id },
      data: { rules: { targets: [] } },
    }),
  ).rejects.toThrow();
  await expect(
    cluster.database.mediaSubtitlePolicyVersion.delete({
      where: { id: policy.id },
    }),
  ).rejects.toThrow();
});
test("shared video requires every exact subtitle episode association and rejects conflicting flags", async () => {
  const f = await fixture();
  const plan = await cluster.database.mediaHandoffPlan.findUniqueOrThrow({
    where: { id: f.planId },
    include: { bundleReview: { include: { bundle: true } } },
  });
  const scope = HandoffScopeSchema.parse(plan.scope);
  const manifest = MigrationBundleSchema.parse(
    plan.bundleReview.bundle.manifest,
  );
  const report = BundleReportSchema.parse(plan.bundleReview.report);
  const entry = report.entries.find(
    (item) => item.sourceRecord.kind === "subtitle",
  );
  const file = scope.files[0];
  if (file === undefined || entry?.sourceRecord.kind !== "subtitle")
    throw new Error("Subtitle fixture missing");
  const siblingId = crypto.randomUUID();
  const files = [{ ...file, mediaIds: [...file.mediaIds, siblingId] }];
  const project = (selected: typeof report.entries) =>
    projectHandoffSubtitles({
      tx: cluster.database,
      request: scope.request,
      manifest,
      files,
      selected,
    });
  await expect(project([entry])).rejects.toThrow("every exact source episode");
  const sibling = {
    ...entry,
    mediaIds: [siblingId],
    provenanceKey: snapshotHash(siblingId),
  };
  const result = await project([entry, sibling]);
  expect(result.subtitles).toHaveLength(1);
  expect(result.subtitles[0]?.provenanceKeys).toHaveLength(2);
  await expect(
    project([
      entry,
      { ...sibling, sourceRecord: { ...entry.sourceRecord, forced: true } },
    ]),
  ).rejects.toThrow("Conflicting subtitle");
});
test("changed sidecar bytes after owner review cannot be adopted", async () => {
  const f = await fixture();
  const ready = await f.ready();
  await writeFile(
    path.join(path.dirname(f.target), "Film.en.srt"),
    "Changed captions after review",
  );
  await expect(
    applyPreparedHandoff(f.context, ready.input, ready.prepared),
  ).rejects.toThrow();
  expect(
    await cluster.database.subtitleAsset.count({
      where: {
        id: { in: ready.prepared.scope.subtitles.map((item) => item.id) },
      },
    }),
  ).toBe(0);
});
test("same-byte replacement sidecar inode changes require a new review", async () => {
  const f = await fixture();
  const ready = await f.ready();
  const target = path.join(path.dirname(f.target), "Film.en.srt");
  const replacement = `${target}.replacement`;
  await writeFile(replacement, await readFile(target));
  await rename(replacement, target);
  await expect(
    applyPreparedHandoff(
      f.context,
      ready.input,
      await prepareHandoffFiles(f.context, f.planId),
    ),
  ).rejects.toThrow("evidence changed");
});
test("wrong manager instance cannot adopt a colliding numeric source ID", async () => {
  await expect(fixture({ wrongInstance: true })).rejects.toThrow(
    "manager instance",
  );
});
test("embedded tracks require exact ffprobe index/codec/language/disposition and stay unverified", async () => {
  const f = await fixture({ embedded: true });
  const inspect = f.context.files.inspect;
  if (inspect === undefined) throw new Error("Synthetic inspector missing");
  f.context.files.inspect = async (file) => ({
    ...(await inspect(file)),
    streams: [
      {
        index: 0,
        codec_type: "video",
        width: 1920,
        height: 1080,
        codec_name: "h264",
      },
      {
        index: 2,
        codec_type: "subtitle",
        codec_name: "hdmv_pgs_subtitle",
        tags: { language: "eng" },
        disposition: { forced: 0, hearing_impaired: 0 },
      },
    ],
  });
  const ready = await f.ready();
  expect(ready.prepared.evidence.files[0]?.subtitles[0]).toMatchObject({
    streamIndex: 2,
    codec: "hdmv_pgs_subtitle",
    storageKind: "embedded",
    qualityStatus: "unverified",
  });
  await applyPreparedHandoff(f.context, ready.input, ready.prepared);
  const next = await fixture({ embedded: true });
  await next.observe();
  await expect(prepareHandoffFiles(next.context, next.planId)).rejects.toThrow(
    "stream identity",
  );
});
