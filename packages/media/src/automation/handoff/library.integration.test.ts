import { afterAll, beforeAll, expect, test } from "vitest";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import {
  MOVIE_EDITION_REGISTRY,
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import {
  LibraryHandoffScopeV2Schema,
  PrepareLibraryHandoffV2Schema,
} from "#shared/handoff-v2.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { handoffFixture } from "./test-fixture.ts";
import { applyPreparedHandoff } from "./apply.ts";
import { createHandoffFileActivities } from "./activities.ts";
import type {
  BundleReportSchema,
  MigrationBundleSchema,
} from "#shared/migration-handoff.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let bytes: Uint8Array;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  bytes = await movieVideoFixture();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture(
  edition: MovieEditionKey,
  options: {
    fileName?: string;
    ownerReview?: boolean;
    secondEdition?: boolean;
    subtitle?: boolean;
  } = {},
) {
  const label = MOVIE_EDITION_REGISTRY[edition].plexLabel;
  const value = await handoffFixture(cluster.database, {
    initialEdition: edition,
    fileName:
      options.fileName ??
      `Synthetic Film (2020)${edition === "default" ? "" : ` {edition-${label}}`}.1080p.mkv`,
    bytes,
    async extendReport({ report, manifest, target }) {
      directories.push(path.dirname(path.dirname(target)));
      if (options.subtitle) await appendSidecar({ report, manifest, target });
      if (!options.secondEdition) return;
      const original = report.entries.find((entry) => entry.kind === "file");
      if (original?.sourceRecord.kind !== "file")
        throw new Error("Missing source file fixture");
      const name = "Synthetic Film (2020) {edition-Theatrical Cut}.1080p.mkv";
      await writeFile(path.join(path.dirname(target), name), bytes);
      const sourceRecord = {
        ...original.sourceRecord,
        sourceId: "file2",
        path: `/movies/${name}`,
      };
      report.entries.push({
        ...original,
        sourceRecord,
        sourceId: "file2",
        provenanceKey: snapshotHash({ file2: target }),
        observationHash: snapshotHash(sourceRecord),
      });
    },
    prepareRequest({ request, report }) {
      const files = report.entries.filter((entry) => entry.kind === "file");
      return PrepareLibraryHandoffV2Schema.parse({
        ...request,
        schemaVersion: 2,
        purpose: "migration",
        selected: report.entries
          .filter((entry) => ["file", "subtitle"].includes(entry.kind))
          .map((entry) => ({
            provenanceKey: entry.provenanceKey,
            evidenceHash: entry.observationHash,
          })),
        movies: files.map((entry, index) => ({
          provenanceKey: entry.provenanceKey,
          edition: index === 0 ? edition : "theatrical_cut",
          resolution: options.ownerReview
            ? {
                kind: "owner_review",
                reason: "Owner inspected this exact source file and cut",
              }
            : { kind: "conventional" },
        })),
      });
    },
  });
  value.context.files.inspect = inspectMedia;
  if (options.secondEdition) {
    const original = await value.network.context.plex.metadata("fixture");
    const second = {
      ...original,
      ratingKey: "second",
      editionTitle: "Theatrical Cut",
      Media: [
        {
          Part: [
            {
              id: 2,
              file: path.join(
                path.dirname(value.target),
                "Synthetic Film (2020) {edition-Theatrical Cut}.1080p.mkv",
              ),
              size: bytes.byteLength,
            },
          ],
        },
      ],
    };
    value.network.context.plex.libraryPage = () =>
      Promise.resolve({ total: 2, items: [original, second] });
    value.network.context.plex.metadata = (key) =>
      Promise.resolve(key === "second" ? second : original);
  }
  return value;
}

test.each(MovieEditionKeySchema.options)(
  "initial adoption owns %s once, retaining actual bytes, paths and exact Plex binding without a requester or torrent",
  async (edition) => {
    const f = await fixture(edition);
    const torrentsBefore = await cluster.database.torrent.count();
    const before = await lstat(f.target, { bigint: true });
    const ready = await f.ready();
    const scope = LibraryHandoffScopeV2Schema.parse(ready.prepared.scope);
    expect(scope.files[0]?.classification).toMatchObject({
      parserVersion: "cut-markers-v2",
      resolution: { kind: "conventional" },
    });
    const id = await applyPreparedHandoff(
      f.context,
      ready.input,
      ready.prepared,
    );
    expect(
      await applyPreparedHandoff(f.context, ready.input, ready.prepared),
    ).toBe(id);
    const asset = await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { path: f.target },
      include: { coverage: true },
    });
    expect(asset).toMatchObject({
      edition,
      editionRootId: f.network.media.id,
      owned: true,
      ownershipEpoch: 0,
      torrentId: null,
      state: "published",
    });
    expect(asset.coverage).toMatchObject([
      { mediaId: f.network.media.id, edition, current: true },
    ]);
    expect(await readFile(f.target)).toEqual(Buffer.from(bytes));
    const after = await lstat(f.target, { bigint: true });
    expect([after.ino, after.mtimeNs]).toEqual([before.ino, before.mtimeNs]);
    expect(
      await cluster.database.mediaRequest.count({
        where: { mediaId: f.network.media.id },
      }),
    ).toBe(0);
    expect(await cluster.database.torrent.count()).toBe(torrentsBefore);
    const receipt =
      await cluster.database.mediaHandoffReceipt.findUniqueOrThrow({
        where: { id },
      });
    expect(
      z
        .object({
          networkEvidence: z.object({
            schemaVersion: z.literal(2),
            plex: z.array(
              z.object({
                ratingKey: z.string(),
                partId: z.number(),
                edition: z.string(),
                canonicalPath: z.string(),
              }),
            ),
          }),
        })
        .parse(receipt.selection).networkEvidence.plex,
    ).toEqual([
      expect.objectContaining({
        ratingKey: "fixture",
        partId: 1,
        edition,
        canonicalPath: f.target,
      }),
    ]);
    expect(
      await cluster.database.recoveryHold.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.network.media.id, edition } },
      }),
    ).toMatchObject({ releasedAt: null });
  },
);

test("two cuts of one movie acquire independent owners at their existing paths", async () => {
  const f = await fixture("directors_cut", { secondEdition: true });
  const ready = await f.ready();
  await applyPreparedHandoff(f.context, ready.input, ready.prepared);
  const assets = await cluster.database.libraryAsset.findMany({
    where: { editionRootId: f.network.media.id },
    orderBy: { edition: "asc" },
  });
  expect(assets.map((asset) => asset.edition)).toEqual([
    "directors_cut",
    "theatrical_cut",
  ]);
  expect(new Set(assets.map((asset) => asset.path)).size).toBe(2);
  expect(
    await cluster.database.mediaRequest.count({
      where: { mediaId: f.network.media.id },
    }),
  ).toBe(0);
});

async function appendSidecar(input: {
  report: z.infer<typeof BundleReportSchema>;
  manifest: z.infer<typeof MigrationBundleSchema>;
  target: string;
}) {
  const { report, manifest, target } = input;
  const file = report.entries.find((entry) => entry.kind === "file");
  const manager = manifest.captures.find(
    (capture) => capture.sourceKind === "radarr",
  );
  if (manager === undefined || file?.sourceRecord.kind !== "file")
    throw new Error("Source video fixture missing");
  const captureHash = snapshotHash({ bazarr: target });
  manifest.captures.push({
    captureId: crypto.randomUUID(),
    captureHash,
    sourceKind: "bazarr",
    sourceInstanceId: snapshotHash("library-bazarr"),
  });
  const name = `${path.basename(target, path.extname(target))}.en.srt`;
  await writeFile(
    path.join(path.dirname(target), name),
    "1\n00:00:00,000 --> 00:00:01,000\nRetained household caption\n",
  );
  const sourceRecord = {
    kind: "subtitle" as const,
    sourceId: "radarr:subtitle1",
    mediaSourceId: "radarr:1",
    videoPath: file.sourceRecord.path,
    path: `/movies/${name}`,
    embeddedTrackId: null,
    language: "en",
    forced: null,
    hearingImpaired: null,
    checksum: null,
    provenance: "unknown" as const,
    managerReference: {
      kind: "radarr" as const,
      sourceMediaId: "1",
      sourceInstanceId: manager.sourceInstanceId,
      binding: "owner_declared" as const,
    },
  };
  report.entries.push({
    ...file,
    sourceRecord,
    sourceId: sourceRecord.sourceId,
    kind: "subtitle",
    captureHash,
    provenanceKey: snapshotHash({ subtitle: target }),
    observationHash: snapshotHash(sourceRecord),
  });
}

test("the files Activity preserves a named cut's existing captions and acknowledges its committed receipt after state changes", async () => {
  const f = await fixture("directors_cut", { subtitle: true });
  const captionPath = `${f.target.slice(0, -4)}.en.srt`;
  const original = await readFile(captionPath);
  const ready = await f.ready();
  const activities = createHandoffFileActivities(f.context);
  await activities.applyMediaHandoffFiles(ready.input);
  const asset = await cluster.database.libraryAsset.findUniqueOrThrow({
    where: { path: f.target },
    include: { subtitles: true },
  });
  expect(asset.subtitles).toMatchObject([
    {
      path: captionPath,
      providerId: "migration",
      state: "installed",
      qualityStatus: "unverified",
      forced: null,
      hearingImpaired: null,
    },
  ]);
  const receipt = await cluster.database.mediaHandoffReceipt.findUniqueOrThrow({
    where: { planId: f.planId },
  });
  expect(
    z
      .object({
        schemaVersion: z.literal(2),
        assets: z.array(
          z.object({
            id: z.string(),
            edition: z.string(),
            subtitles: z.array(z.object({ id: z.string() })),
          }),
        ),
      })
      .parse(receipt.selection).assets,
  ).toMatchObject([
    {
      id: asset.id,
      edition: "directors_cut",
      subtitles: [{ id: asset.subtitles[0]?.id }],
    },
  ]);
  await cluster.database.mediaUser.update({
    where: { id: f.network.actor.id },
    data: { restricted: true },
  });
  f.context.files.inspect = () =>
    Promise.reject(new Error("Committed adoption must not inspect again"));
  await expect(
    activities.applyMediaHandoffFiles(ready.input),
  ).resolves.toBeUndefined();
  expect(await readFile(captionPath)).toEqual(original);
});

test("ambiguous DC needs review of the exact file and never silently becomes theatrical", async () => {
  await expect(
    fixture("directors_cut", {
      fileName: "Synthetic Film (2020) {edition-DC}.mkv",
    }),
  ).rejects.toMatchObject({
    code: "library_movie_classification_requires_review",
  });
  const f = await fixture("directors_cut", {
    fileName: "Synthetic Film (2020) {edition-DC}.mkv",
    ownerReview: true,
  });
  const ready = await f.ready();
  const scope = LibraryHandoffScopeV2Schema.parse(ready.prepared.scope);
  expect(scope.files[0]?.classification).toMatchObject({
    conclusion: { kind: "ambiguous" },
    resolution: { kind: "owner_review" },
  });
  await applyPreparedHandoff(f.context, ready.input, ready.prepared);
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { path: f.target },
    }),
  ).toMatchObject({ edition: "directors_cut" });
});

test("changed Plex cut protects before ownership and leaves the file untouched", async () => {
  const f = await fixture("extended_cut");
  const original = await f.network.context.plex.metadata("fixture");
  f.network.context.plex.metadata = () =>
    Promise.resolve({ ...original, editionTitle: "Theatrical Cut" });
  await expect(f.ready()).rejects.toMatchObject({
    code: "handoff_plex_edition_requires_review",
  });
  expect(
    await cluster.database.libraryAsset.findUnique({
      where: { path: f.target },
    }),
  ).toBeNull();
  expect(await readFile(f.target)).toEqual(Buffer.from(bytes));
});

test("an unversioned migration cannot bypass movie classification", async () => {
  const f = await fixture("default");
  await expect(
    f.commands.prepare(f.network.actor, crypto.randomUUID(), {
      ...f.request,
      purpose: "migration",
    }),
  ).rejects.toMatchObject({ code: "library_handoff_version_required" });
  expect(
    await cluster.database.libraryAsset.findUnique({
      where: { path: f.target },
    }),
  ).toBeNull();
});

test("initial adoption cannot reassign an already managed file even to the same cut", async () => {
  const f = await fixture("final_cut");
  const ready = await f.ready();
  await applyPreparedHandoff(f.context, ready.input, ready.prepared);
  const scope = LibraryHandoffScopeV2Schema.parse(ready.prepared.scope);
  await expect(
    f.commands.prepare(f.network.actor, crypto.randomUUID(), {
      ...scope.request,
      activation: "extend",
      runtimeVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "library_asset_already_managed" });
  expect(
    await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { path: f.target },
    }),
  ).toMatchObject({ edition: "final_cut", version: 0 });
});
