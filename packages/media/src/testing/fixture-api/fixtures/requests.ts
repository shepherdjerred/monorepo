import type { z } from "zod";
import type { RequestListSchema } from "#shared/api.ts";
import type { MediaItem } from "#shared/contract.ts";
import {
  RequestInterestIncludeSchema,
  type RequestInterestListSchema,
  type RequestInterestViewSchema,
} from "#shared/household/interests.ts";
import type { RequestInterestProgressSchema } from "#shared/household/progress.ts";
import type { ImportedPersonalClaimsSchema } from "#shared/personal-migration/contract.ts";
import {
  KIDS,
  personaUser,
  type Persona,
} from "#testing/fixture-api/personas.ts";
import {
  DAY,
  MINUTE,
  ago,
  ahead,
  fixtureId,
  parseFixtureId,
  pick,
  sha256,
} from "#testing/fixture-api/support.ts";
import { storedArtwork } from "./artwork.ts";
import {
  episodeItem,
  resolveMedia,
  seasonItem,
  titleItem,
  titleNamed,
} from "./titles.ts";

type RequestList = z.input<typeof RequestListSchema>;
type InterestView = z.input<typeof RequestInterestViewSchema>;
type InterestList = z.input<typeof RequestInterestListSchema>;
type InterestProgress = z.input<typeof RequestInterestProgressSchema>;
type ImportedClaims = z.input<typeof ImportedPersonalClaimsSchema>;

export function requestId(sequence: number): string {
  return fixtureId(5, sequence);
}

type RequestSeed = {
  sequence: number;
  item: MediaItem;
  active?: boolean;
  languages?: string[];
  future?: boolean;
  specials?: boolean;
};

function root(name: string): MediaItem {
  return titleItem(titleNamed(name));
}

const REQUEST_SEEDS: readonly RequestSeed[] = [
  { sequence: 1, item: root("Severance"), languages: ["en"], future: true },
  { sequence: 2, item: root("The Bear"), future: true },
  { sequence: 3, item: root("Shōgun"), languages: ["en", "zh-Hans"] },
  { sequence: 4, item: seasonItem(titleNamed("Andor"), 2), languages: ["en"] },
  { sequence: 5, item: root("Slow Horses"), languages: ["en"], future: true },
  { sequence: 6, item: seasonItem(titleNamed("The Last of Us"), 2) },
  {
    sequence: 7,
    item: root("Frieren: Beyond Journey's End"),
    languages: ["en", "zh-Hans"],
    future: true,
    specials: true,
  },
  { sequence: 8, item: root("Silo"), languages: ["en"] },
  { sequence: 9, item: root("Twin Peaks") },
  { sequence: 10, item: root("Hacks"), active: false, languages: ["en"] },
  {
    sequence: 11,
    item: {
      ...episodeItem(titleNamed("Arcane"), 2, 9),
      title: "The Dirt Under Your Nails",
    },
    languages: ["en"],
  },
  { sequence: 12, item: root("Bluey"), future: true, specials: true },
  { sequence: 13, item: root("Dark"), languages: ["en"] },
  { sequence: 14, item: root("Ted Lasso"), languages: ["en"], future: true },
  { sequence: 15, item: root("The Expanse") },
  { sequence: 16, item: root("Dune: Part Two"), languages: ["en"] },
  { sequence: 17, item: root("Anora"), languages: ["en"] },
];

/** The signed-in person's requests, each with the item it asks for. */
export function requestList(persona: Persona): RequestList {
  const user = personaUser(persona);
  return REQUEST_SEEDS.map((seed) => {
    const resolved = resolveMedia(seed.item.id);
    if (resolved === null) {
      throw new Error(`Request fixture names an unknown item ${seed.item.id}`);
    }
    return {
      id: requestId(seed.sequence),
      userId: user.id,
      mediaId: seed.item.id,
      active: seed.active ?? true,
      subtitleLanguages: seed.languages ?? [],
      includeFutureEpisodes: seed.future ?? false,
      includeSpecials: seed.specials ?? false,
      version: (seed.sequence % 4) + 1,
      media: seed.item,
      // A requested season or episode names its series and shows its art.
      rootMediaId: resolved.title.id,
      rootTitle: resolved.title.title,
      artwork: storedArtwork(resolved.title),
    };
  });
}

function interest(
  sequence: number,
  title: string,
  userId: string,
  overrides: Partial<InterestView> = {},
): InterestView {
  return {
    requestId: requestId(sequence),
    mediaId: titleNamed(title).id,
    edition: "default",
    userId,
    title,
    keepingPolicy: "temporary",
    interestState: "following",
    version: (sequence % 4) + 1,
    interestRevision: sequence % 3,
    renewedAt: ago((sequence + 2) * DAY),
    releasedAt: null,
    releaseReason: null,
    noticeEventId: null,
    replyBy: null,
    noticeDeliveryState: null,
    noticeReason: null,
    ...overrides,
  };
}

/** The request that starts the second interest page. */
const SECOND_INTEREST_PAGE = requestId(14);

/**
 * Two pages of interests covering every interest state, every interest-check
 * delivery state, and (for the owner) a request held for a managed profile.
 */
export function interestList(
  parameters: URLSearchParams,
  persona: Persona,
): InterestList {
  const include = RequestInterestIncludeSchema.optional().parse(
    parameters.get("include") ?? undefined,
  );
  const page = interestPage(parameters.get("cursor"), persona);
  // The rows are a strict contract: like the server, add artwork only for a
  // caller that asks for it, so an earlier client never receives the key.
  return include === "artwork"
    ? {
        ...page,
        items: page.items.map((item) => ({
          ...item,
          artwork: storedArtwork(titleNamed(item.title)),
        })),
      }
    : page;
}

function interestPage(cursor: string | null, persona: Persona): InterestList {
  const mine = personaUser(persona).id;
  if (cursor === SECOND_INTEREST_PAGE) {
    return {
      items: [
        interest(14, "Ted Lasso", mine),
        interest(15, "The Expanse", mine, { keepingPolicy: "keep" }),
        interest(13, "Dark", mine),
      ],
      nextCursor: null,
    };
  }
  if (cursor !== null) {
    throw new Error(`Unknown interest cursor ${cursor}`);
  }
  return {
    items: [
      interest(1, "Severance", mine),
      interest(16, "Dune: Part Two", mine, { keepingPolicy: "keep" }),
      interest(2, "The Bear", mine, {
        noticeEventId: fixtureId(9, 201),
        noticeDeliveryState: "pending",
      }),
      interest(3, "Shōgun", mine, {
        noticeEventId: fixtureId(9, 202),
        replyBy: ahead(5 * DAY),
        noticeDeliveryState: "accepted",
      }),
      interest(5, "Slow Horses", mine, {
        noticeEventId: fixtureId(9, 203),
        noticeDeliveryState: "attention",
        noticeReason: "email_bounced",
      }),
      interest(10, "Hacks", mine, {
        interestState: "finished",
        releasedAt: ago(3 * DAY),
        releaseReason: "finished_by_requester",
      }),
      interest(9, "Twin Peaks", mine, {
        interestState: "dropped",
        releasedAt: ago(21 * DAY),
        releaseReason: "dropped_by_requester",
      }),
      interest(8, "Silo", mine, {
        interestState: "expired",
        releasedAt: ago(9 * DAY),
        releaseReason: "interest_check_expired",
      }),
      interest(12, "Bluey", persona === "owner" ? KIDS.id : mine, {
        keepingPolicy: "keep",
      }),
      interest(18, "Oppenheimer", mine),
    ],
    nextCursor: SECOND_INTEREST_PAGE,
  };
}

/**
 * A request's interest as the interests list reports it. A request that list
 * leaves out is still followed, at the revision the list would give it.
 */
export function requestInterest(
  id: string,
  persona: Persona,
): Pick<InterestView, "interestRevision" | "interestState"> {
  const listed = [null, SECOND_INTEREST_PAGE]
    .flatMap((cursor) => interestPage(cursor, persona).items)
    .find((item) => item.requestId === id);
  if (listed !== undefined) {
    return {
      interestRevision: listed.interestRevision,
      interestState: listed.interestState,
    };
  }
  const parsed = parseFixtureId(id);
  if (parsed?.namespace !== 5) {
    throw new Error(`Not a fixture request identifier: ${id}`);
  }
  return { interestRevision: parsed.sequence % 3, interestState: "following" };
}

/** Requests carried over from the previous request manager. */
export function importedClaims(persona: Persona): ImportedClaims {
  const userId = personaUser(persona).id;
  const captureId = fixtureId(9, 301);
  return [
    {
      requestId: requestId(1),
      mediaId: titleNamed("Severance").id,
      userId,
      edition: "default",
      captureId,
      provenanceKey: sha256("claim-1"),
      sourceId: "1401",
      sourceStatus: 5,
      needsAcquisitionChoice: false,
      sourceKind: "seerr",
      sourceFulfilled: true,
    },
    {
      requestId: requestId(18),
      mediaId: titleNamed("Oppenheimer").id,
      userId,
      edition: "default",
      captureId,
      provenanceKey: sha256("claim-18"),
      sourceId: "1418",
      sourceStatus: 2,
      needsAcquisitionChoice: true,
      sourceKind: "overseerr",
      sourceFulfilled: false,
    },
    {
      requestId: requestId(15),
      mediaId: titleNamed("The Expanse").id,
      userId,
      edition: "default",
      captureId,
      provenanceKey: sha256("claim-15"),
      sourceId: "1415",
      sourceStatus: 5,
      needsAcquisitionChoice: false,
      sourceKind: "jellyseerr",
      sourceFulfilled: true,
    },
  ];
}

type ProgressVariant = Pick<InterestProgress, "status" | "reason" | "counts">;

const PROGRESS_VARIANTS: readonly ProgressVariant[] = [
  {
    status: "following",
    reason: "requested_content_unavailable",
    counts: {
      requested: 19,
      released: 17,
      available: 15,
      watched: 11,
      captionsPending: 1,
    },
  },
  {
    status: "caught_up",
    reason: "following_future_episodes",
    counts: {
      requested: 38,
      released: 38,
      available: 38,
      watched: 38,
      captionsPending: 0,
    },
  },
  {
    status: "complete",
    reason: null,
    counts: {
      requested: 10,
      released: 10,
      available: 10,
      watched: 10,
      captionsPending: 0,
    },
  },
  {
    status: "released",
    reason: "interest_released",
    counts: {
      requested: 22,
      released: 22,
      available: 22,
      watched: 22,
      captionsPending: 0,
    },
  },
  {
    status: "unknown",
    reason: "requester_access_not_current",
    counts: {
      requested: 36,
      released: null,
      available: null,
      watched: null,
      captionsPending: null,
    },
  },
];

/** Progress for one request; null when the identifier is not a request. */
export function interestProgress(id: string): InterestProgress | null {
  const parsed = parseFixtureId(id);
  if (parsed?.namespace !== 5) {
    return null;
  }
  return {
    schemaVersion: 1,
    requestId: id,
    observedAt: ago(4 * MINUTE),
    // Request 1 (the first row on the requests page) is mid-season.
    ...pick(PROGRESS_VARIANTS, parsed.sequence - 1),
  };
}
