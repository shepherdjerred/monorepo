import { expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import { matchRelease } from "#domain/release-parser.ts";
import { evaluateRelease } from "#domain/quality.ts";
import { persistCandidateSnapshot } from "#automation/candidate-evidence.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import {
  candidateDigest,
  identityHash,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { assertCurrentMovieAssessment } from "#infrastructure/movie-editions/release-assessment.ts";
import {
  assessRetainedMovieRelease,
  prepareMovieAssessment,
} from "./release-assessment.ts";

const h = automationTestHarness();

async function fixture() {
  const f = await h.fixture();
  const db = h.database();
  await chooseTestMovieEdition(db, {
    actor: f.user,
    mediaId: f.media.id,
    edition: "extended_cut",
    access: { serverMachineId: "fixture-server", movieSectionId: "1" },
  });
  await db.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: f.media.id, edition: "extended_cut" },
    },
    data: { profileId: f.profile.id },
  });
  const providerReleaseId = crypto.randomUUID();
  const provider = new KnabenProvider(() =>
    Promise.resolve(
      Response.json({
        hits: [
          {
            id: providerReleaseId,
            title: "Example.2020.Extended.Cut.1080p.WEB-DL.H264.ENG",
            bytes: f.source.sizeBytes,
            hash: f.source.infoHash,
            seeders: 2,
            details: f.source.detailsUrl,
            magnetUrl: f.source.download.value,
          },
        ],
      }),
    ),
  );
  const [source] = await provider.search({
    query: "Another movie",
    kind: "movie",
    page: 1,
  });
  if (source === undefined)
    throw new Error("Actual provider adapter omitted fixture result");
  const wrong = await db.mediaItem.create({
    data: { kind: "movie", title: "Another movie", year: 2018 },
  });
  const attributes = matchRelease({
    id: crypto.randomUUID(),
    providerId: source.providerId,
    title: source.title,
    sizeBytes: source.sizeBytes,
    media: {
      id: wrong.id,
      kind: "movie",
      title: wrong.title,
      year: wrong.year,
    },
    knownEpisodes: [],
  }).attributes;
  expect(attributes.identityConfidence).toBe("mismatch");
  expect(attributes.mediaIds).toEqual([wrong.id]);
  const profile = {
    id: f.profile.id,
    version: f.profile.version,
    ...QualityRulesSchema.parse(f.profile.rules),
  };
  const evaluation = evaluateRelease(attributes, profile, [wrong.id]);
  expect(evaluation.accepted).toBe(false);
  const stored = await persistCandidateSnapshot(h.context(), {
    source,
    attributes,
    evaluation,
    searchedForMediaId: wrong.id,
  });
  if (stored === null)
    throw new Error(
      "Actual legacy snapshot producer rejected fresh fixture source",
    );
  const original = await db.releaseCandidate.findUniqueOrThrow({
    where: { id: stored.id },
  });
  const scope = MovieEditionScopeSchema.parse({
    mediaId: f.media.id,
    rootMediaId: f.media.id,
    edition: "extended_cut",
  });
  return {
    ...f,
    db,
    source,
    wrong,
    original,
    scope,
    evaluatingProfile: profile,
    input: { releaseId: stored.id, scope },
  };
}

test("v4 appends a correct scoped assessment of a legacy-rejected source without rewriting its attributes, query coverage or original digest", async () => {
  const f = await fixture();
  const digest = candidateDigest(f.original);
  const result = await assessRetainedMovieRelease(h.context(), {
    ...f.input,
    observedSource: f.source,
  });
  expect(result.value).toMatchObject({
    schemaVersion: 1,
    parserVersion: "movie-release-v4",
    scope: f.scope,
    sourceHash: digest,
    attributes: {
      mediaIds: [f.media.id],
      identityConfidence: "exact",
      quality: "WEB-1080p",
      audioLanguages: ["en"],
    },
    cut: {
      schemaVersion: 2,
      conclusion: { kind: "named", cut: "extended_cut" },
    },
  });
  expect(
    evaluateRelease(
      {
        id: f.original.id,
        providerId: f.original.providerId,
        title: f.original.title,
        ...result.value.attributes,
      },
      f.evaluatingProfile,
      [f.media.id],
    ).accepted,
  ).toBe(true);
  const retained = await f.db.releaseCandidate.findUniqueOrThrow({
    where: { id: f.original.id },
  });
  expect(retained).toEqual(f.original);
  expect(candidateDigest(retained)).toBe(digest);
  await f.db.mediaItem.update({
    where: { id: f.media.id },
    data: { version: { increment: 1 } },
  });
  expect(await assessRetainedMovieRelease(h.context(), f.input)).toEqual(
    result,
  );
  const current = await assertCurrentMovieAssessment(
    f.db,
    result.ref,
    f.scope,
    f.original.id,
  );
  expect(current.value).toEqual(result.value);
  const updated = {
    id: retained.id,
    providerId: retained.providerId,
    title: retained.title,
    ...result.value.attributes,
  };
  expect(
    await persistCandidateSnapshot(h.context(), {
      source: f.source,
      attributes: updated,
      evaluation: { accepted: true, reasons: [], qualityRank: 0, score: 0 },
    }),
  ).toBeNull();
  expect(
    await f.db.releaseCandidate.findUniqueOrThrow({
      where: { id: retained.id },
    }),
  ).toEqual(f.original);
});

test("concurrent v4 observations deduplicate one immutable source/work/edition/profile assessment", async () => {
  const f = await fixture();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      assessRetainedMovieRelease(h.context(), f.input),
    ),
  );
  for (const result of results) expect(result).toEqual(results[0]);
  expect(
    await f.db.movieReleaseAssessment.count({
      where: { releaseId: f.original.id },
    }),
  ).toBe(1);
});

test("metadata and profile changes append assessments, protect stale authority, and preserve prior literal evidence", async () => {
  const f = await fixture();
  const first = await assessRetainedMovieRelease(h.context(), f.input);
  const originalRow = await f.db.movieReleaseAssessment.findUniqueOrThrow({
    where: { id: first.ref.id },
  });
  await f.db.mediaItem.update({
    where: { id: f.media.id },
    data: { runtimeMinutes: 120, originalLanguage: "en" },
  });
  await expect(
    assertCurrentMovieAssessment(f.db, first.ref, f.scope, f.original.id),
  ).rejects.toMatchObject({ code: "movie_assessment_changed" });
  const second = await assessRetainedMovieRelease(h.context(), f.input);
  expect(second.ref.id).not.toBe(first.ref.id);
  const rules = {
    ...QualityRulesSchema.parse(f.profile.rules),
    minimumScore: 2,
  };
  await f.db.qualityProfileVersion.create({
    data: { profileId: f.profile.id, version: 1, rules },
  });
  await f.db.qualityProfile.update({
    where: { id: f.profile.id },
    data: { version: 1, rules },
  });
  await expect(
    assertCurrentMovieAssessment(f.db, second.ref, f.scope, f.original.id),
  ).rejects.toMatchObject({ code: "movie_assessment_changed" });
  const third = await assessRetainedMovieRelease(h.context(), f.input);
  expect(third.value.profile.version).toBe(1);
  expect(third.ref.id).not.toBe(second.ref.id);
  expect(
    await f.db.movieReleaseAssessment.count({
      where: { releaseId: f.original.id },
    }),
  ).toBe(3);
  expect(
    await f.db.movieReleaseAssessment.findUniqueOrThrow({
      where: { id: first.ref.id },
    }),
  ).toEqual(originalRow);
  expect(
    await f.db.releaseCandidate.findUniqueOrThrow({
      where: { id: f.original.id },
    }),
  ).toEqual(f.original);
});

test("assessment references cannot borrow another release, edition, movie, or literal hash", async () => {
  const f = await fixture();
  const assessed = await assessRetainedMovieRelease(h.context(), f.input);
  for (const [ref, scope, releaseId] of [
    [{ ...assessed.ref, hash: "b".repeat(64) }, f.scope, f.original.id],
    [assessed.ref, { ...f.scope, edition: "default" }, f.original.id],
    [
      assessed.ref,
      { ...f.scope, mediaId: f.wrong.id, rootMediaId: f.wrong.id },
      f.original.id,
    ],
    [assessed.ref, f.scope, f.release.id],
  ] as const)
    await expect(
      assertCurrentMovieAssessment(f.db, ref, scope, releaseId),
    ).rejects.toMatchObject({ code: "movie_assessment_changed" });
  await expect(
    prepareMovieAssessment(h.context(), {
      ...f.input,
      observedSource: { ...f.source, infoHash: "f".repeat(40) },
    }),
  ).rejects.toMatchObject({ code: "identity_source_changed" });
});

test("PostgreSQL rejects assessment mutation, deletion, literal hash/header tampering, source relabeling and later provider snapshot edits", async () => {
  const f = await fixture();
  const assessed = await assessRetainedMovieRelease(h.context(), f.input);
  const row = await f.db.movieReleaseAssessment.findUniqueOrThrow({
    where: { id: assessed.ref.id },
  });
  await expect(
    f.db.movieReleaseAssessment.update({
      where: { id: row.id },
      data: { raw: row.raw },
    }),
  ).rejects.toThrow("Movie release assessment is immutable");
  await expect(
    f.db.movieReleaseAssessment.delete({ where: { id: row.id } }),
  ).rejects.toThrow("Movie release assessment is immutable");
  for (const data of [
    { title: "Substituted source" },
    { mediaIds: [f.media.id] },
    { encryptedSource: "changed" },
    { sourceEvidence: { infoHash: "f".repeat(40) } },
    { attributes: assessed.value.attributes },
  ])
    await expect(
      f.db.releaseCandidate.update({ where: { id: f.original.id }, data }),
    ).rejects.toThrow("Assessed provider snapshot is immutable");
  for (const tamper of ["raw", "header", "source"] as const) {
    const value = structuredClone(assessed.value);
    value.canonicalHash = identityHash(crypto.randomUUID());
    if (tamper === "source") {
      const text = value.cut.texts[0];
      if (text === undefined)
        throw new Error("Assessment omitted exact source title");
      text.text = "Substituted source";
    }
    const raw = canonicalJson(z.json().parse(value));
    await expect(
      f.db.movieReleaseAssessment.create({
        data: {
          ...row,
          id: crypto.randomUUID(),
          canonicalHash: value.canonicalHash,
          raw: tamper === "raw" ? `${raw} ` : raw,
          assessment: z.record(z.string(), z.json()).parse(value),
          assessmentHash: identityHash(value),
          ...(tamper === "header" ? { edition: "default" } : {}),
        },
      }),
    ).rejects.toThrow(
      tamper === "source"
        ? "Movie assessment source or target scope mismatch"
        : `movie_assessment_${tamper}`,
    );
  }
  expect(
    await f.db.releaseCandidate.findUniqueOrThrow({
      where: { id: f.original.id },
    }),
  ).toEqual(f.original);
  expect(
    await f.db.movieReleaseAssessment.findUniqueOrThrow({
      where: { id: row.id },
    }),
  ).toEqual(row);
});
