import { afterEach, expect, test } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { ResolvedEvidenceSchema } from "#domain/resolved-evidence.ts";

const harness = automationTestHarness();
const directories: string[] = [];
let seriesTmdbId = 1234;
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(tv = false) {
  const db = harness.database();
  const series = tv
    ? await db.mediaItem.create({
        data: {
          kind: "series",
          title: "Coastlines",
          year: 2026,
          tmdbId: seriesTmdbId++,
        },
      })
    : null;
  const file = await fileFixture(
    db,
    series === null ? undefined : { seriesId: series.id },
  );
  directories.push(file.directory);
  return {
    ...file,
    db,
    series,
    activities: createMediaFileActivities(file.context),
  };
}
async function upgrade(f: Awaited<ReturnType<typeof fixture>>) {
  const acquired = await f.acquisition("New higher quality fixture content");
  const release = await f.db.releaseCandidate.findUniqueOrThrow({
    where: { id: acquired.attempt.releaseId },
  });
  await f.db.releaseCandidate.update({
    where: { id: release.id },
    data: {
      attributes: {
        ...z.record(z.string(), z.json()).parse(release.attributes),
        quality: "WEB-2160p",
      },
    },
  });
  const inspect = f.context.inspect;
  if (inspect === undefined) throw new Error("Fixture inspector missing");
  f.context.inspect = async (filename) => {
    const probe = await inspect(filename);
    return {
      ...probe,
      streams: probe.streams.map((stream) =>
        stream.codec_type === "video"
          ? { ...stream, width: 3840, height: 2160 }
          : stream,
      ),
    };
  };
  return acquired;
}
test.each([
  "Test.Film.2026.Directors.Cut.1080p.mkv",
  "Different.Name.Directors.Cut/feature.mkv",
  "Different.Name.Directors.Cut.m4v",
])(
  "legacy NULL identity rejects named member %s before staging",
  async (filename) => {
    const f = await fixture();
    const acquired = await f.acquisition();
    expect(acquired.attempt.identityEvidence).toBeNull();
    await mkdir(path.dirname(path.join(f.roots.downloads, filename)), {
      recursive: true,
    });
    await writeFile(path.join(f.roots.downloads, filename), acquired.content);
    await f.db.torrent.update({
      where: { id: z.string().parse(acquired.attempt.torrentId) },
      data: {
        observation: {
          torrent: { progress: 1, save_path: f.roots.downloads },
          files: [
            {
              name: filename,
              size: Buffer.byteLength(acquired.content),
              progress: 1,
            },
          ],
        },
      },
    });
    expect(await f.activities.inspectAndStageMedia(acquired.input)).toEqual({
      status: "blocked",
      reason: "edition_candidate_incompatible",
    });
    expect(
      await f.db.libraryAsset.count({
        where: { coverage: { some: { mediaId: f.media.id } } },
      }),
    ).toBe(0);
    const blocked = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    expect(blocked.filePlan).toBeNull();
  },
);
test.each([
  {
    title: "Second",
    names: ["Coastlines.S01E01.mkv", "Coastlines.S01E02.Extended.Cut.mkv"],
  },
  {
    title: "Extended Cut",
    names: ["Coastlines.S01E01.Extended.Cut.mkv", "Coastlines.S01E02.mkv"],
  },
  {
    title: "Extended Cut",
    names: ["Coastlines.S01E01-E02.Extended.Cut.mkv", "Coastlines.S01E02.mkv"],
  },
])(
  "all members retain coordinate-specific cut evidence before staging: $names",
  async ({ title, names }) => {
    const f = await fixture(true);
    if (f.series === null) throw new Error("Series fixture missing");
    const second = await f.db.mediaItem.create({
      data: {
        kind: "episode",
        title,
        parentId: f.series.id,
        seasonNumber: 1,
        episodeNumber: 2,
      },
    });
    await f.db.$transaction(async (tx) => {
      await lockDefaultScopes(tx, [defaultScope(second.id)], {
        createMissing: true,
      });
      await tx.mediaIntent.update({
        where: targetWhere(defaultScope(second.id)),
        data: {
          profileId: f.profile.id,
          automationEpoch: 0,
          desiredPresence: true,
          monitoring: true,
        },
      });
      await tx.mediaRequest.create({
        data: { mediaId: second.id, userId: f.user.id },
      });
    });
    const acquired = await f.acquisition(undefined, [f.media.id, second.id]);
    for (const name of names)
      await writeFile(path.join(f.roots.downloads, name), acquired.content);
    await f.db.torrent.update({
      where: { id: z.string().parse(acquired.attempt.torrentId) },
      data: {
        observation: {
          torrent: { progress: 1, save_path: f.roots.downloads },
          files: names.map((name, index) => ({
            index,
            name,
            size: Buffer.byteLength(acquired.content),
            progress: 1,
          })),
        },
      },
    });
    const checkpoints: string[] = [];
    f.context.checkpoint = (phase) => {
      checkpoints.push(phase);
      return Promise.resolve();
    };
    expect(await f.activities.inspectAndStageMedia(acquired.input)).toEqual({
      status: "blocked",
      reason: "edition_candidate_incompatible",
    });
    expect(checkpoints).not.toContain("staged");
    const blocked = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    });
    expect(blocked.filePlan).toBeNull();
  },
);
test("ordinary unmarked quality upgrade publishes and preserves its previous rollback bytes", async () => {
  const f = await fixture();
  const previous = await f.published();
  const next = await upgrade(f);
  expect(await f.activities.inspectAndStageMedia(next.input)).toEqual({
    status: "staged",
  });
  expect(await f.activities.promoteMediaFiles(next.input)).toEqual({
    status: "published",
  });
  const old = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: previous.entry.assetId },
  });
  expect(old.state).toBe("superseded");
  expect(await readFile(old.path, "utf8")).toBe(previous.content);
  expect(await f.activities.rollbackMediaPromotion(next.input)).toEqual({
    status: "rolled_back",
  });
  expect(
    await readFile(
      path.join(f.roots.library, previous.entry.libraryPath),
      "utf8",
    ),
  ).toBe(previous.content);
});
test("current cut drift after content hashing protects the old file before publication", async () => {
  const f = await fixture();
  const previous = await f.published();
  const next = await upgrade(f);
  expect(await f.activities.inspectAndStageMedia(next.input)).toEqual({
    status: "staged",
  });
  let changed = false;
  f.context.checkpoint = async (phase) => {
    if (phase !== "content-proof-ready" || changed) return;
    changed = true;
    const asset = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: previous.entry.assetId },
    });
    await f.db.libraryAsset.update({
      where: { id: asset.id },
      data: {
        properties: {
          ...z.record(z.string(), z.json()).parse(asset.properties),
          title: "Test.Film.2026.Extended.Cut",
        },
      },
    });
  };
  expect(await f.activities.promoteMediaFiles(next.input)).toEqual({
    status: "blocked",
    reason: "edition_current_requires_classification",
  });
  expect(
    await readFile(
      path.join(f.roots.library, previous.entry.libraryPath),
      "utf8",
    ),
  ).toBe(previous.content);
  expect(
    await f.db.libraryAsset.count({
      where: { coverage: { some: { mediaId: f.media.id } } },
    }),
  ).toBe(1);
});
test.each(["edition_candidate_incompatible", "edition_provenance_missing"])(
  "%s compensates an actual rename whose database commit was lost",
  async (reason) => {
    const f = await fixture();
    const previous = await f.published();
    const next = await upgrade(f);
    expect(await f.activities.inspectAndStageMedia(next.input)).toEqual({
      status: "staged",
    });
    const staged = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: next.attempt.id },
    });
    const plan = FilePlanSchema.parse(staged.filePlan);
    const entry = plan[0];
    if (entry === undefined) throw new Error("Missing staged file");
    f.context.checkpoint = (phase) =>
      phase === "published"
        ? Promise.reject(new Error("lost database commit"))
        : Promise.resolve();
    await expect(f.activities.promoteMediaFiles(next.input)).rejects.toThrow(
      "lost database commit",
    );
    expect(
      await readFile(path.join(f.roots.library, entry.libraryPath), "utf8"),
    ).toBe(next.content);
    if (reason === "edition_candidate_incompatible") {
      await f.db.releaseCandidate.update({
        where: { id: next.attempt.releaseId },
        data: { title: "Test.Film.2026.Directors.Cut.2160p.WEB-DL" },
      });
    } else {
      const asset = await f.db.libraryAsset.findUniqueOrThrow({
        where: { id: previous.entry.assetId },
      });
      const properties = z.record(z.string(), z.json()).parse(asset.properties);
      delete properties["releaseId"];
      await f.db.libraryAsset.update({
        where: { id: asset.id },
        data: {
          sourcePath: asset.path,
          properties: {
            ...properties,
            id: `handoff:${asset.id}`,
            providerId: "migration",
            title: path.basename(asset.path),
            resolvedEvidence: ResolvedEvidenceSchema.parse({
              schemaVersion: 1,
              source: "radarr",
              sourceVersion: "5.27.5",
              parserVersion: "handoff-v1",
              release: {
                id: `handoff:${asset.id}`,
                qualityId: 3,
                identityConfirmed: true,
                releaseTitle: null,
                filename: path.basename(asset.path),
                releaseGroup: null,
                sizeBytes: Number(asset.sizeBytes),
                runtimeMinutes: null,
                audioLanguages: ["en"],
                originalLanguage: null,
                revision: null,
                specialEpisode: false,
              },
              protectedReasons: [],
              regex: {
                engine: "dotnet-ignorecase",
                culture: "en-US",
                observations: [],
              },
            }),
          },
        },
      });
    }
    f.context.checkpoint = () => Promise.resolve();
    expect(await f.activities.inspectAndStageMedia(next.input)).toEqual({
      status: "blocked",
      reason,
    });
    expect(
      await readFile(path.join(f.roots.library, entry.libraryPath), "utf8"),
    ).toBe(previous.content);
    const recovered = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: next.attempt.id },
    });
    expect(recovered.filePlan).toEqual(staged.filePlan);
    expect(recovered.state).toBe("obsolete");
    expect(
      await f.db.libraryAsset.findUnique({ where: { id: entry.assetId } }),
    ).toBeNull();
  },
);
test("already committed publication reconciles despite newly recognized source cut without rewriting history", async () => {
  const f = await fixture();
  const acquired = await f.acquisition();
  expect(await f.activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await f.activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const committed = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  await f.db.releaseCandidate.update({
    where: { id: acquired.attempt.releaseId },
    data: { title: "Test.Film.2026.Directors.Cut" },
  });
  expect(await f.activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await f.activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: acquired.attempt.id },
    }),
  ).toEqual(committed);
});
