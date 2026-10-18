import { expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { persistCandidateSnapshot } from "./candidate-evidence.ts";
import { searchCandidates, loadProfile } from "./acquisition-candidates.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { StoredCandidateSchema } from "./providers.ts";
import { captureMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";

const { database, context, fixture, cipher } = automationTestHarness();
const evaluation = { accepted: true, reasons: [], qualityRank: 0, score: 0 };
async function snapshotFixture() {
  const f = await fixture();
  const ctx = context();
  const source = StoredCandidateSchema.parse({
    ...f.source,
    providerReleaseId: crypto.randomUUID(),
    title: "Example.2020.1080p.WEB-DL.H264.English-GROUP",
  });
  ctx.providers = {
    withProvider: async (_providerId, work) =>
      await work({ search: () => Promise.resolve([source]) }),
  };
  const profile = await loadProfile(database(), f.media.id);
  if (profile === null) throw new Error("Missing profile");
  const ids = await searchCandidates(ctx, f.media.id, profile);
  const id = ids[0];
  if (id === undefined) throw new Error("Candidate not selected");
  const row = await database().releaseCandidate.findUniqueOrThrow({
    where: { id },
  });
  const attributes = {
    id,
    providerId: row.providerId,
    title: row.title,
    ...PublicReleaseAttributesSchema.parse(row.attributes),
  };
  const request = await database().mediaRequest.findFirstOrThrow({
    where: { mediaId: f.media.id },
  });
  const claim = {
    ...(await captureMovieAttemptChoice(database(), {
      sponsorRequestId: request.id,
      scope: {
        rootMediaId: f.media.id,
        mediaId: f.media.id,
        edition: "default",
      },
      access: { serverMachineId: "fixture-server", movieSectionId: "1" },
    })),
    releaseId: id,
    sponsorRequestId: request.id,
    mediaIds: [f.media.id],
    generations: { [f.media.id]: f.input.generation },
    operationId: crypto.randomUUID(),
    state: "reserved",
  };
  return { ...f, ctx, source, profile, row, attributes, claim };
}
function decrypt(row: {
  providerId: string;
  providerReleaseId: string;
  encryptedSource: string | null;
}) {
  if (row.encryptedSource === null) throw new Error("Missing encrypted source");
  return StoredCandidateSchema.parse(
    JSON.parse(
      cipher.decrypt(
        row.encryptedSource,
        `release:${row.providerId}:${row.providerReleaseId}`,
      ),
    ),
  );
}
test("reused provider ID cannot change a claimed source or reselect old attributes for a new download", async () => {
  const f = await snapshotFixture();
  await database().acquisitionAttempt.create({ data: f.claim });
  const replacement = {
    ...f.source,
    title: "Different.Film.2020.1080p.WEB-DL.H264-GROUP",
    sizeBytes: 9000,
    infoHash: "b".repeat(40),
    download: {
      kind: "magnet" as const,
      value: `magnet:?xt=urn:btih:${"b".repeat(40)}`,
    },
  };
  f.ctx.providers = {
    withProvider: async (_providerId, work) =>
      await work({ search: () => Promise.resolve([replacement]) }),
  };
  expect(await searchCandidates(f.ctx, f.media.id, f.profile)).toEqual([]);
  const unchanged = await database().releaseCandidate.findUniqueOrThrow({
    where: { id: f.row.id },
  });
  expect(unchanged).toEqual(f.row);
  expect(decrypt(unchanged)).toEqual(f.source);
  // Even equal display metadata cannot conceal a changed hash/download target.
  expect(
    await persistCandidateSnapshot(f.ctx, {
      source: {
        ...f.source,
        infoHash: replacement.infoHash,
        download: replacement.download,
      },
      attributes: f.attributes,
      evaluation,
    }),
  ).toBeNull();
  expect(
    decrypt(
      await database().releaseCandidate.findUniqueOrThrow({
        where: { id: f.row.id },
      }),
    ),
  ).toEqual(f.source);
});
test("unclaimed source identity drift is protected; identical identity refresh is atomic", async () => {
  const f = await snapshotFixture();
  expect(
    await persistCandidateSnapshot(f.ctx, {
      source: {
        ...f.source,
        download: {
          kind: "torrent",
          value: "https://synthetic.invalid/changed",
        },
      },
      attributes: f.attributes,
      evaluation,
    }),
  ).toBeNull();
  const refreshedSource = { ...f.source, seeders: 123 };
  const refreshed = await persistCandidateSnapshot(f.ctx, {
    source: refreshedSource,
    attributes: f.attributes,
    evaluation: { ...evaluation, score: 5 },
  });
  expect(refreshed?.id).toBe(f.row.id);
  const row = await database().releaseCandidate.findUniqueOrThrow({
    where: { id: f.row.id },
  });
  expect(decrypt(row)).toEqual(refreshedSource);
  expect(row.evaluation).toMatchObject({ score: 5 });
  expect(PublicReleaseAttributesSchema.parse(row.attributes)).toEqual(
    PublicReleaseAttributesSchema.parse(f.attributes),
  );
});
test("a claim holding its FK lock prevents refresh until claimed evidence and source are immutable", async () => {
  const f = await snapshotFixture();
  const claimed = Promise.withResolvers<undefined>();
  const releaseClaim = Promise.withResolvers<undefined>();
  const claim = database().$transaction(
    async (tx) => {
      await tx.acquisitionAttempt.create({ data: f.claim });
      claimed.resolve(undefined);
      await releaseClaim.promise;
    },
    { timeout: 10_000 },
  );
  await claimed.promise;
  const refresh = persistCandidateSnapshot(f.ctx, {
    source: { ...f.source, seeders: 999 },
    attributes: f.attributes,
    evaluation: { ...evaluation, score: 99 },
  });
  try {
    await expect
      .poll(
        async () => {
          const rows = z
            .array(z.object({ waiting: z.boolean() }))
            .parse(
              await database()
                .$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%ReleaseCandidate%' AND pid <> pg_backend_pid()) AS waiting`,
            );
          return rows[0]?.waiting;
        },
        { timeout: 2000, interval: 10 },
      )
      .toBe(true);
  } finally {
    releaseClaim.resolve(undefined);
  }
  await claim;
  expect(await refresh).toEqual(f.attributes);
  const row = await database().releaseCandidate.findUniqueOrThrow({
    where: { id: f.row.id },
  });
  expect(row).toEqual(f.row);
  expect(decrypt(row)).toEqual(f.source);
});
