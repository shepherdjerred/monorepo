import type { z } from "zod";
import type {
  SubtitleReplacementDetailSchema,
  SubtitleReplacementListSchema,
} from "#shared/subtitle-replacement.ts";
import {
  DAY,
  HOUR,
  ago,
  ahead,
  fixtureId,
  sha256,
} from "#testing/fixture-api/support.ts";
import { titleNamed } from "#testing/fixture-api/fixtures/titles.ts";

type Detail = z.input<typeof SubtitleReplacementDetailSchema>;
type List = z.input<typeof SubtitleReplacementListSchema>;

/** One replacement in each state the page has to show. */
export const REPLACEMENT_IDS = {
  awaitingReview: fixtureId(34, 1),
  preparing: fixtureId(34, 2),
  applying: fixtureId(34, 3),
  applied: fixtureId(34, 4),
  rolledBack: fixtureId(34, 5),
  protectedState: fixtureId(34, 6),
  reconciling: fixtureId(34, 7),
  abandoned: fixtureId(34, 8),
  expired: fixtureId(34, 9),
} as const;

type Seed = {
  id: string;
  state: Detail["state"];
  title: string;
  language: string;
  forced: boolean | null;
  hearingImpaired: boolean | null;
  oldQuality: Detail["oldQuality"];
  reason?: string;
  reviewExpiresInHours?: number;
  archiveDays?: number;
  cleanupState?: string;
  cleanupReason?: string;
  reservationActive?: boolean;
  receiptOutcome?: string;
  movieEdition?: "directors_cut";
};

const SEEDS: readonly Seed[] = [
  {
    id: REPLACEMENT_IDS.awaitingReview,
    state: "awaiting_review",
    title: "Dune: Part Two",
    language: "en",
    forced: false,
    hearingImpaired: true,
    oldQuality: "unverified",
    reviewExpiresInHours: 20,
    reservationActive: true,
    movieEdition: "directors_cut",
  },
  {
    id: REPLACEMENT_IDS.preparing,
    state: "preparing",
    title: "Blade Runner 2049",
    language: "en",
    forced: false,
    hearingImpaired: false,
    oldQuality: "accepted",
    reservationActive: true,
  },
  {
    id: REPLACEMENT_IDS.applying,
    state: "applying",
    title: "Arrival",
    language: "zh-Hans",
    forced: false,
    hearingImpaired: null,
    oldQuality: "rejected",
    reviewExpiresInHours: 20,
    reservationActive: true,
  },
  {
    id: REPLACEMENT_IDS.applied,
    state: "applied",
    title: "The Godfather",
    language: "en",
    forced: false,
    hearingImpaired: false,
    oldQuality: "accepted",
    archiveDays: 6,
    cleanupState: "scheduled",
    receiptOutcome: "applied",
  },
  {
    id: REPLACEMENT_IDS.rolledBack,
    state: "rolled_back",
    title: "Parasite",
    language: "en",
    forced: true,
    hearingImpaired: false,
    oldQuality: "accepted",
    archiveDays: 2,
    cleanupState: "protected",
    cleanupReason: "replacement_not_settled",
    receiptOutcome: "rolled_back",
  },
  {
    id: REPLACEMENT_IDS.protectedState,
    state: "protected",
    title: "Heat",
    language: "en",
    forced: false,
    hearingImpaired: false,
    oldQuality: "accepted",
    reason: "subtitle_replacement_artifact_ownership_unconfirmed",
    reservationActive: true,
  },
  {
    id: REPLACEMENT_IDS.reconciling,
    state: "reconciling",
    title: "Spirited Away",
    language: "en",
    forced: false,
    hearingImpaired: false,
    oldQuality: "accepted",
    reservationActive: true,
  },
  {
    id: REPLACEMENT_IDS.abandoned,
    state: "abandoned",
    title: "Whiplash",
    language: "en",
    forced: false,
    hearingImpaired: false,
    oldQuality: "unverified",
  },
  {
    id: REPLACEMENT_IDS.expired,
    state: "awaiting_review",
    title: "Alien",
    language: "en",
    forced: false,
    hearingImpaired: false,
    oldQuality: "accepted",
    reviewExpiresInHours: -3,
    reservationActive: true,
  },
];

function detailOf(seed: Seed): Detail {
  const title = titleNamed(seed.title);
  const hours = seed.reviewExpiresInHours;
  const observed =
    seed.state === "preparing" ? null : sha256(`observation:${seed.id}`);
  return {
    ...(seed.movieEdition === undefined
      ? {}
      : {
          movieScope: {
            rootMediaId: title.id,
            mediaId: title.id,
            edition: seed.movieEdition,
          },
        }),
    id: seed.id,
    version: 3,
    state: seed.state,
    reason: seed.reason ?? null,
    titles: [{ mediaId: title.id, title: title.title }],
    language: seed.language,
    forced: seed.forced,
    hearingImpaired: seed.hearingImpaired,
    oldQuality: seed.oldQuality,
    newQuality: "accepted",
    oldProvider: "opensubtitles",
    newProvider: "manual upload",
    destinationName: `${title.title.replaceAll(":", "")} (${String(title.year)}).${seed.language}.srt`,
    observationHash: observed,
    reviewExpiresAt:
      hours === undefined
        ? null
        : hours >= 0
          ? ahead(hours * HOUR)
          : ago(-hours * HOUR),
    archiveExpiresAt:
      seed.archiveDays === undefined ? null : ahead(seed.archiveDays * DAY),
    cleanupState: seed.cleanupState ?? "not_started",
    cleanupReason: seed.cleanupReason ?? null,
    reservationActive: seed.reservationActive ?? false,
    receiptOutcome: seed.receiptOutcome ?? null,
  };
}

export function subtitleReplacementList(): List {
  return { items: SEEDS.map((seed) => detailOf(seed)), nextCursor: null };
}

export function subtitleReplacementDetail(id: string): Detail | null {
  const seed = SEEDS.find((candidate) => candidate.id === id);
  return seed === undefined ? null : detailOf(seed);
}
