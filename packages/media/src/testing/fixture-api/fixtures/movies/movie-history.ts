import type { z } from "zod";
import type {
  MovieHistoryDetailV3Schema,
  MovieHistoryPersonalDetailV3Schema,
  PrepareMovieHistoryV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import type { MovieHistoryPendingV3Schema } from "#shared/movie-editions/history-review-views-v3.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import {
  KIDS,
  MEMBER,
  OWNER,
  type Persona,
} from "#testing/fixture-api/personas.ts";
import {
  DAY,
  HOUR,
  ago,
  ahead,
  fixtureId,
  sha256,
} from "#testing/fixture-api/support.ts";
import { definitionDigest, movieScope } from "./movie-requests.ts";
import {
  MACHINE,
  SUBJECTS,
  claimIdentity,
  recoverySubject,
  type Subject,
} from "#testing/fixture-api/fixtures/migration/recovery.ts";
import {
  TITLES,
  titleNamed,
  type Title,
} from "#testing/fixture-api/fixtures/titles.ts";

type Pending = z.input<typeof MovieHistoryPendingV3Schema>;
type OwnerDetail = z.input<typeof MovieHistoryDetailV3Schema>;
type PersonalDetail = z.input<typeof MovieHistoryPersonalDetailV3Schema>;
type Context = z.input<typeof PrepareMovieHistoryV3Schema>;

/**
 * Three cuts with a household review. Blade Runner's final cut has the owner
 * declared and two people still to; Alien's director's cut has everyone
 * declared and is ready to apply; Interstellar's unmarked release has a
 * person with no choice to declare and cannot be applied yet.
 */
const REVIEWS = [
  { title: "Blade Runner", edition: "final_cut", days: 5 },
  { title: "Alien", edition: "directors_cut", days: 9 },
  { title: "Interstellar", edition: "default", days: 2 },
] as const satisfies readonly {
  title: string;
  edition: MovieEditionKey;
  days: number;
}[];

type Seed = (typeof REVIEWS)[number] & { n: number };
const SEEDS: readonly Seed[] = REVIEWS.map((review, index) => ({
  ...review,
  n: index + 1,
}));

const reviewId = (seed: Seed) => fixtureId(19, seed.n);

/** Whether `viewer` has declared on a review, as the fixture has it. */
function declared(seed: Seed, user: Subject["user"]): boolean {
  return seed.n === 2 || (seed.n === 1 && user.id === OWNER.id);
}

/** Whether a person has an active request for the cut, as the fixture has it. */
function hasRequest(seed: Seed, user: Subject["user"]): boolean {
  return seed.n !== 3 || user.id === OWNER.id;
}

function requestOf(seed: Seed, row: Subject, mediaId: string) {
  const at = ago(12 * DAY);
  const key = seed.n * 10 + SUBJECTS.indexOf(row);
  return {
    id: fixtureId(23, key),
    userId: row.user.id,
    mediaId,
    edition: seed.edition,
    version: 7,
    active: true,
    excluded: false,
    direct: true,
    movieEditionChoiceId: fixtureId(24, key),
    movieEditionChoiceRevision: 1,
    subtitleLanguages: row.user.id === MEMBER.id ? ["zh-Hans", "en"] : ["en"],
    createdAt: at,
    updatedAt: at,
  };
}

function choiceOf(seed: Seed, row: Subject, mediaId: string) {
  const request = requestOf(seed, row, mediaId);
  return {
    id: request.movieEditionChoiceId,
    requestId: request.id,
    choiceRevision: 1,
    actorId: OWNER.id,
    subjectUserId: row.user.id,
    rootMediaId: mediaId,
    edition: seed.edition,
    definitionVersion: 0 as const,
    registryVersion: 1 as const,
    requestVersionAtChoice: 7,
    authority: {
      schemaVersion: 1 as const,
      mode: row.authority,
      actorVersion: OWNER.version,
      subjectVersion: row.user.version,
      mappingVersion: 4,
      serverMachineId: MACHINE,
      homeUserId: row.home,
      serverAccountId: row.home === null ? row.user.plexAccountId : "31",
    },
    createdAt: ago(12 * DAY),
  };
}

/** The Keep or pin a person has for the cut: the owner pins, others keep. */
function keepOf(seed: Seed, row: Subject, mediaId: string) {
  return {
    id: fixtureId(25, seed.n * 10 + SUBJECTS.indexOf(row)),
    userId: row.user.id,
    mediaId,
    edition: seed.edition,
    until: row.user.id === OWNER.id ? null : ahead(20 * DAY),
    isPin: row.user.id === OWNER.id,
    createdAt: ago(6 * DAY),
  };
}

function definitionOf(title: Title, edition: MovieEditionKey) {
  return {
    definitionVersion: 0 as const,
    definitionDigest: definitionDigest(title, edition),
  };
}

/** What a person declared, which for the fixture is `request` and `keep`. */
function declarationOf(seed: Seed, row: Subject, mediaId: string) {
  const request = requestOf(seed, row, mediaId);
  const currentChoice = {
    requestId: request.id,
    requestVersion: request.version,
    choiceId: request.movieEditionChoiceId,
    choiceRevision: 1,
    subtitleLanguages: request.subtitleLanguages,
  };
  const keeps = row.user.id !== KIDS.id;
  return keeps
    ? {
        intent: "keep" as const,
        currentChoice,
        currentKeep: keepOf(seed, row, mediaId),
      }
    : { intent: "request" as const, currentChoice };
}

function storedResponse(seed: Seed, row: Subject, title: Title) {
  return {
    schemaVersion: 3 as const,
    scope: movieScope(title, seed.edition),
    scopeHash: sha256(`history-scope-${String(seed.n)}`),
    subjectUserId: row.user.id,
    definition: definitionOf(title, seed.edition),
    registryVersion: 1 as const,
    declaration: declarationOf(seed, row, title.id),
    claimAcknowledgements: [],
    acknowledgeMissingHistory: true as const,
    authority: {
      mode: row.authority,
      actorId: OWNER.id,
      actorVersion: OWNER.version,
      subjectUserId: row.user.id,
      mappingVersion: 4,
    },
  };
}

function subjectOf(seed: Seed, row: Subject, title: Title) {
  const claims = row.user.id === MEMBER.id && seed.n === 1 ? 1 : 0;
  return {
    ...recoverySubject(row, [title.id], claims),
    claimAcknowledgements: Array.from({ length: claims }, () => ({
      ...claimIdentity(1),
      mediaIds: [title.id],
    })),
  };
}

function seedFor(id: string): Seed | null {
  return SEEDS.find((seed) => reviewId(seed) === id) ?? null;
}

/** Pending cut reviews, optionally for one edition. */
export function movieHistoryReviews(parameters: URLSearchParams): Pending {
  const mediaId = parameters.get("mediaId");
  const edition = parameters.get("edition");
  return {
    reviews: SEEDS.map((seed) => {
      const title = titleNamed(seed.title);
      return {
        id: reviewId(seed),
        version: seed.n,
        scope: movieScope(title, seed.edition),
        definition: definitionOf(title, seed.edition),
        title: title.title,
        expiresAt: ahead(seed.days * DAY),
        responded: seed.n === 2,
      };
    }).filter(
      (review) =>
        mediaId === null ||
        (review.scope.mediaId === mediaId && review.scope.edition === edition),
    ),
  };
}

function ownerDetail(seed: Seed): OwnerDetail {
  const title = titleNamed(seed.title);
  const scope = movieScope(title, seed.edition);
  const people = SUBJECTS.filter((row) => hasRequest(seed, row.user));
  const everyone = SUBJECTS.map((row) => subjectOf(seed, row, title));
  const responses = SUBJECTS.filter((row) => declared(seed, row.user)).map(
    (row, index) => ({
      userId: row.user.id,
      actorId: OWNER.id,
      response: storedResponse(seed, row, title),
      createdAt: ago((index + 1) * HOUR),
    }),
  );
  const bindingHash = sha256(`binding-${String(seed.n)}`);
  const at = ago(9 * DAY);
  return {
    id: reviewId(seed),
    state: "awaiting_responses",
    version: seed.n + 1,
    scopeHash: sha256(`history-scope-${String(seed.n)}`),
    responseHash: sha256(`history-responses-${String(seed.n)}`),
    expiresAt: ahead(seed.days * DAY),
    scope: {
      schemaVersion: 3,
      scope,
      definition: definitionOf(title, seed.edition),
      registryVersion: 1,
      recoveryEpoch: 1,
      runtimeVersion: 12,
      media: { id: title.id, title: title.title, version: 4, kind: "movie" },
      target: {
        mediaId: title.id,
        edition: seed.edition,
        editionRootId: title.id,
        version: 3,
        generation: 2,
        automationEpoch: 1,
        profileId: null,
        desiredPresence: true,
        monitoring: true,
        libraryMonitoring: true,
        availability: "available",
        intentionallyRemovedAt: null,
      },
      profile: null,
      hold: {
        mediaId: title.id,
        edition: seed.edition,
        version: 1,
        recoveryEpoch: 1,
        reason: "migration_household_intent_review_required",
        createdAt: ago(10 * DAY),
      },
      access: { serverMachineId: MACHINE, movieSectionId: "1" },
      adoption: {
        receiptId: fixtureId(26, seed.n),
        planId: fixtureId(27, seed.n),
        planHash: sha256(`plan-${String(seed.n)}`),
        assetId: fixtureId(28, seed.n),
        bindingHash,
        actorId: OWNER.id,
        assetRaw: "{}",
        planRaw: "{}",
      },
      publication: {
        kind: "movie_library_adoption_v2",
        scope,
        receiptId: fixtureId(26, seed.n),
        planId: fixtureId(27, seed.n),
        planHash: sha256(`plan-${String(seed.n)}`),
        assetId: fixtureId(28, seed.n),
        assetVersion: 0,
        bindingHash,
        physicalEvidenceHash: sha256(`physical-${String(seed.n)}`),
      },
      asset: {
        schemaVersion: 2,
        id: fixtureId(28, seed.n),
        version: 0,
        edition: seed.edition,
        editionRootId: title.id,
        owned: true,
        ownershipEpoch: 1,
        state: "published",
        path: `/media/movies/${title.title} (${String(title.year)})/${title.title}.mkv`,
        sourcePath: null,
        checksum: sha256(`file-${String(seed.n)}`),
        sizeBytes: "18253611008",
        properties: {},
        supersededByAssetId: null,
        plexPublishedAt: at,
        rollbackExpiresAt: null,
        scope,
        coverage: [{ mediaId: title.id, edition: seed.edition, current: true }],
        subtitles: [],
        subtitleHistory: [],
      },
      binding: {
        scope: { mediaId: title.id, edition: seed.edition },
        evidenceId: fixtureId(29, seed.n),
        associationHash: sha256(`association-${String(seed.n)}`),
        revision: 2,
      },
      requests: people.map((row) => requestOf(seed, row, title.id)),
      choices: people.map((row) => choiceOf(seed, row, title.id)),
      personalHolds: people
        .filter((row) => row.user.id !== KIDS.id)
        .map((row) => keepOf(seed, row, title.id)),
      users: everyone,
      householdRoster: everyone,
      excludedPairs: [],
      legacyClaims: [],
      blockers: seed.n === 3 ? ["movie_history_acquisition_unsettled"] : [],
    },
    responses,
    missingUserIds: SUBJECTS.filter((row) => !declared(seed, row.user)).map(
      (row) => row.user.id,
    ),
    receiptId: null,
  };
}

function personalDetail(seed: Seed): PersonalDetail {
  const title = titleNamed(seed.title);
  const row = SUBJECTS[1];
  const person = ownerDetail(seed);
  const requests = hasRequest(seed, row.user)
    ? [requestOf(seed, row, title.id)]
    : [];
  return {
    id: reviewId(seed),
    state: "awaiting_responses",
    version: person.version,
    scopeHash: person.scopeHash,
    expiresAt: person.expiresAt,
    scope: movieScope(title, seed.edition),
    definition: definitionOf(title, seed.edition),
    registryVersion: 1,
    title: title.title,
    subject: subjectOf(seed, row, title),
    requests,
    choices: requests.length === 0 ? [] : [choiceOf(seed, row, title.id)],
    personalHolds: seed.n === 3 ? [] : [keepOf(seed, row, title.id)],
    response: declared(seed, row.user)
      ? storedResponse(seed, row, title)
      : null,
  };
}

/** A review as the reader may see it: the whole household's, or only their own. */
export function movieHistoryDetail(
  persona: Persona,
  id: string,
): OwnerDetail | PersonalDetail | null {
  const seed = seedFor(id);
  if (seed === null) return null;
  return persona === "owner" ? ownerDetail(seed) : personalDetail(seed);
}

/** What the owner captures a review from, for any film in the library. */
export function movieHistoryContext(
  mediaId: string,
  edition: MovieEditionKey,
): Context | null {
  const title = TITLES.find((item) => item.id === mediaId);
  if (title?.kind !== "movie") return null;
  return {
    schemaVersion: 3,
    scope: movieScope(title, edition),
    expected: {
      mediaVersion: 4,
      targetVersion: 3,
      holdVersion: 1,
      definition: definitionOf(title, edition),
    },
  };
}
