import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { MovieAcquisitionIdentityV2Schema } from "#shared/movie-editions/acquisition-v2.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { eligibleAcquisitionSponsors } from "#infrastructure/movie-editions/authority.ts";
import { searchMovieCandidatesV4 } from "./candidates.ts";
import { reserveMovieCandidateV4 } from "./reservation.ts";
import { matchRelease } from "#domain/release-parser.ts";
import { evaluateRelease } from "#domain/quality.ts";
import { persistCandidateSnapshot } from "#automation/candidate-evidence.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";

const h = automationTestHarness();
const labels = {
  default: "",
  theatrical_cut: ".THEATRICAL",
  directors_cut: ".Directors.Cut",
  extended_cut: ".EXTENDED",
  final_cut: ".Final.Cut",
  unrated_cut: ".UNRATED",
  uncut_version: ".UNCUT",
} satisfies Record<MovieEditionKey, string>;

async function fixture(edition: MovieEditionKey = "extended_cut") {
  const f = await h.fixture();
  const db = h.database();
  await db.qualityProfileDefault.upsert({
    where: { kind: "movie" },
    create: { kind: "movie", profileId: f.profile.id },
    update: { profileId: f.profile.id },
  });
  const requested = await requestTestMovieV4(db, f.user, f.media.id, edition);
  const releases = MovieEditionKeySchema.options.map((key) => ({
    id: crypto.randomUUID(),
    title: `Example.2020${labels[key]}.1080p.WEB-DL.H264.ENG`,
    bytes: f.source.sizeBytes,
    hash: crypto.randomUUID().replaceAll("-", "").padEnd(40, "0"),
    seeders: 2,
    details: f.source.detailsUrl,
    magnetUrl: f.source.download.value,
  }));
  // Keep transport identity consistent with the actual adapter output.
  for (const release of releases)
    release.magnetUrl = `magnet:?xt=urn:btih:${release.hash}`;
  const context = h.context();
  const queries: unknown[] = [];
  const provider = new KnabenProvider((url) => {
    queries.push(String(url));
    return Promise.resolve(Response.json({ hits: releases }));
  });
  context.providers = {
    withProvider: async (_providerId, work) => await work(provider),
  };
  return { ...f, ...requested, db, context, releases, queries, provider };
}

test("a legacy-rejected source can be searched and reserved with corrected movie identity while its original work coverage and digest stay literal", async () => {
  const f = await fixture();
  const sources = await f.provider.search({
    query: "Another movie",
    kind: "movie",
    page: 1,
  });
  const source = sources.find((value) => value.title.includes(".EXTENDED."));
  if (source === undefined)
    throw new Error("Actual adapter omitted its named source");
  const wrong = await f.db.mediaItem.create({
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
  const evaluation = evaluateRelease(
    attributes,
    {
      id: f.profile.id,
      version: f.profile.version,
      ...QualityRulesSchema.parse(f.profile.rules),
    },
    [wrong.id],
  );
  expect(evaluation.accepted).toBe(false);
  const retained = await persistCandidateSnapshot(f.context, {
    source,
    attributes,
    evaluation,
    searchedForMediaId: wrong.id,
  });
  if (retained === null)
    throw new Error("Actual legacy snapshot producer rejected a fresh source");
  const original = await f.db.releaseCandidate.findUniqueOrThrow({
    where: { id: retained.id },
  });
  const [selected] = await searchMovieCandidatesV4(f.context, f.input.scope);
  expect(selected?.releaseId).toBe(original.id);
  if (selected === undefined)
    throw new Error("V4 did not reassess the actual legacy source");
  const attemptId = await reserveMovieCandidateV4(
    f.context,
    f.input,
    selected,
    0,
  );
  if (attemptId === null)
    throw new Error("Corrected scoped identity did not reserve");
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const identity = MovieAcquisitionIdentityV2Schema.parse(
    attempt.identityEvidence,
  );
  expect(identity.coverage).toEqual([f.media.id]);
  expect(identity.source.candidateDigest).toBe(candidateDigest(original));
  expect(
    await f.db.releaseCandidate.findUniqueOrThrow({
      where: { id: original.id },
    }),
  ).toEqual(original);
});

test.each(MovieEditionKeySchema.options)(
  "actual mixed provider search reserves only the explicitly requested %s edition",
  async (edition) => {
    const f = await fixture(edition);
    const originalDefault = await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    });
    const candidates = await searchMovieCandidatesV4(f.context, f.input.scope);
    expect(candidates).toHaveLength(1);
    const selected = candidates[0];
    if (selected === undefined)
      throw new Error("Actual movie search omitted its matching cut");
    const source = await f.db.releaseCandidate.findUniqueOrThrow({
      where: { id: selected.releaseId },
    });
    expect(source.title).toBe(
      `Example.2020${labels[edition]}.1080p.WEB-DL.H264.ENG`,
    );
    expect(f.queries).toHaveLength(1);
    const attemptId = await reserveMovieCandidateV4(
      f.context,
      f.input,
      selected,
      0,
    );
    expect(attemptId).not.toBeNull();
    if (attemptId === null) throw new Error("Actual v4 reservation was denied");
    const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { reservations: true },
    });
    expect(attempt).toMatchObject({
      edition,
      releaseId: source.id,
      sponsorRequestId: f.result.requestId,
      state: "reserved",
      reservations: [
        { mediaId: f.media.id, edition, generation: f.input.generation },
      ],
    });
    const identity = MovieAcquisitionIdentityV2Schema.parse(
      attempt.identityEvidence,
    );
    expect(identity).toMatchObject({
      schemaVersion: 2,
      scope: f.input.scope,
      assessment: selected.assessment,
      source: { releaseId: source.id },
    });
    if (edition !== "default") {
      expect(
        await f.db.mediaIntent.findUniqueOrThrow({
          where: {
            mediaId_edition: { mediaId: f.media.id, edition: "default" },
          },
        }),
      ).toEqual(originalDefault);
      expect(
        await eligibleAcquisitionSponsors(f.db, {
          scope: f.input.scope,
          access: { serverMachineId: "fixture-server", movieSectionId: "1" },
        }),
      ).toEqual([]);
    }
  },
);

test("concurrent reservation retries reuse one attempt and preserve its literal birth", async () => {
  const f = await fixture();
  const [selected] = await searchMovieCandidatesV4(f.context, f.input.scope);
  if (selected === undefined) throw new Error("Missing matching movie cut");
  const ids = await Promise.all(
    Array.from({ length: 3 }, () =>
      reserveMovieCandidateV4(f.context, f.input, selected, 0),
    ),
  );
  const id = ids[0];
  if (id == null) throw new Error("Actual reservation did not commit");
  expect(ids).toEqual([id, id, id]);
  const original = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id },
  });
  expect(await reserveMovieCandidateV4(f.context, f.input, selected, 0)).toBe(
    id,
  );
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({ where: { id } }),
  ).toEqual(original);
  expect(
    await f.db.acquisitionAttempt.count({
      where: { operationId: f.input.operationId },
    }),
  ).toBe(1);
});

test("unsupported labels, conflicting cuts, wrong work and wrong year never select a movie candidate", async () => {
  const f = await fixture();
  const titles = [
    "Example.2020.DC",
    "Example.2020.Extended.Theatrical",
    "Another.2020.EXTENDED",
    "Example.2019.EXTENDED",
  ];
  const provider = new KnabenProvider(() =>
    Promise.resolve(
      Response.json({
        hits: titles.map((title) => ({
          id: crypto.randomUUID(),
          title: `${title}.1080p.WEB-DL.H264.ENG`,
          bytes: f.source.sizeBytes,
          hash: f.source.infoHash,
          seeders: 2,
          details: f.source.detailsUrl,
          magnetUrl: f.source.download.value,
        })),
      }),
    ),
  );
  f.context.providers = {
    withProvider: async (_providerId, work) => await work(provider),
  };
  expect(await searchMovieCandidatesV4(f.context, f.input.scope)).toEqual([]);
  expect(
    await f.db.movieReleaseAssessment.count({
      where: { mediaId: f.media.id, edition: f.input.scope.edition },
    }),
  ).toBe(4);
  expect(
    await f.db.acquisitionReservation.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
  expect(
    await f.db.acquisitionAttempt.count({
      where: { operationId: f.input.operationId },
    }),
  ).toBe(0);
});

test("separate editions reserve independently while cross-edition assessment substitution has no effects", async () => {
  const f = await fixture();
  const another = await requestTestMovieV4(
    f.db,
    f.user,
    f.media.id,
    "directors_cut",
  );
  const [extended] = await searchMovieCandidatesV4(f.context, f.input.scope);
  const [directors] = await searchMovieCandidatesV4(
    f.context,
    another.input.scope,
  );
  if (extended === undefined || directors === undefined)
    throw new Error("Mixed provider omitted a registered cut");
  await expect(
    reserveMovieCandidateV4(f.context, another.input, extended, 0),
  ).rejects.toMatchObject({ code: "movie_assessment_changed" });
  expect(
    await f.db.acquisitionReservation.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
  const ids = await Promise.all([
    reserveMovieCandidateV4(f.context, f.input, extended, 0),
    reserveMovieCandidateV4(f.context, another.input, directors, 0),
  ]);
  expect(ids.every((id) => id !== null)).toBe(true);
  expect(new Set(ids).size).toBe(2);
  expect(
    await f.db.acquisitionReservation.findMany({
      where: { mediaId: f.media.id },
      select: { edition: true },
      orderBy: { edition: "asc" },
    }),
  ).toEqual([{ edition: "directors_cut" }, { edition: "extended_cut" }]);
});

test("cancellation prevents later provider access and reservation, even while another edition remains wanted", async () => {
  const f = await fixture();
  const [selected] = await searchMovieCandidatesV4(f.context, f.input.scope);
  if (selected === undefined) throw new Error("Missing matching movie cut");
  await f.commands.cancelMovieEditionRequest(f.user, crypto.randomUUID(), {
    schemaVersion: 3,
    action: "cancel_request",
    subjectUserId: f.user.id,
    scope: f.input.scope,
    requestId: f.result.requestId,
    expected: {
      targetVersion: f.result.applied.targetVersion,
      requestVersion: f.result.applied.requestVersion,
      choiceRevision: f.result.applied.choiceRevision,
    },
  });
  f.queries.length = 0;
  await expect(
    searchMovieCandidatesV4(f.context, f.input.scope),
  ).rejects.toMatchObject({ code: "movie_edition_choice_required" });
  expect(f.queries).toHaveLength(0);
  expect(
    await reserveMovieCandidateV4(f.context, f.input, selected, 0),
  ).toBeNull();
  expect(
    await f.db.acquisitionAttempt.count({
      where: { operationId: f.input.operationId },
    }),
  ).toBe(0);
  expect(
    await f.db.mediaRequest.count({
      where: {
        mediaId: f.media.id,
        edition: "default",
        active: true,
        direct: true,
      },
    }),
  ).toBe(1);
});

test("profile, generation, runtime epoch and feature gate changes prevent a stale reservation", async () => {
  const f = await fixture();
  const [selected] = await searchMovieCandidatesV4(f.context, f.input.scope);
  if (selected === undefined) throw new Error("Missing matching movie cut");
  f.context.gates.acquisition = () => Promise.resolve(false);
  expect(
    await reserveMovieCandidateV4(f.context, f.input, selected, 0),
  ).toBeNull();
  f.context.gates.acquisition = () => Promise.resolve(true);
  expect(
    await reserveMovieCandidateV4(
      f.context,
      { ...f.input, generation: f.input.generation + 1 },
      selected,
      0,
    ),
  ).toBeNull();
  expect(
    await reserveMovieCandidateV4(f.context, f.input, selected, 1),
  ).toBeNull();
  const rules = {
    ...QualityRulesSchema.parse(f.profile.rules),
    minimumScore: 1,
  };
  await f.db.qualityProfileVersion.create({
    data: { profileId: f.profile.id, version: 1, rules },
  });
  await f.db.qualityProfile.update({
    where: { id: f.profile.id },
    data: { version: 1, rules },
  });
  await expect(
    reserveMovieCandidateV4(f.context, f.input, selected, 0),
  ).rejects.toMatchObject({ code: "movie_assessment_changed" });
  expect(
    await f.db.acquisitionAttempt.count({
      where: { operationId: f.input.operationId },
    }),
  ).toBe(0);
  expect(
    await f.db.acquisitionReservation.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
});
