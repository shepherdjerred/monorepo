import { expect, test, vi } from "vitest";
import { CredentialCipher } from "#application/security.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { IntegrationError } from "#integrations/http.ts";
import { collectProviderSearchRound } from "#automation/provider-search/progress.ts";
import { ProviderAdmissionDeferred } from "#automation/providers.ts";
import {
  PROVIDER_SEARCH_MAX_LISTINGS,
  PROVIDER_SEARCH_MAX_PAGES,
  PROVIDER_SEARCH_WINDOW_MS,
} from "#shared/acquisition/provider-search.ts";
import { MovieProviderSearchProgressV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { MovieCandidateSearchProgress } from "./candidate-search-progress.ts";

const criterion = "a".repeat(64);
const cipher = new CredentialCipher(Buffer.alloc(32).toString("base64"));
const hash = "b".repeat(40);
const first: ProviderCandidate = {
  providerId: "knaben",
  providerReleaseId: "first",
  title: "Synthetic film",
  infoHash: hash,
  sizeBytes: 1024,
  seeders: 10,
  detailsUrl: "https://knaben.org/synthetic",
  download: { kind: "magnet", value: `magnet:?xt=urn:btih:${hash}` },
};

test("resumed pages deduplicate exact observations, retain separate tracker listings and reject changed sources", async () => {
  const rank = vi.fn((source: ProviderCandidate) =>
    Promise.resolve({
      candidate: {
        releaseId: crypto.randomUUID(),
        assessment: { id: crypto.randomUUID(), hash: criterion },
        rank: source.providerReleaseId === "winner" ? 2 : 1,
        score: 0,
        priority: 10,
      },
    }),
  );
  let progress = new MovieCandidateSearchProgress(criterion);
  await progress.recordPage(
    "knaben",
    { candidates: [first, first], listingIds: ["first", "first"], nextPage: 2 },
    cipher,
    rank,
  );
  await progress.recordPage(
    "thepiratebay",
    {
      candidates: [{ ...first, providerId: "thepiratebay" }],
      listingIds: ["first"],
      nextPage: null,
    },
    cipher,
    rank,
  );
  progress.nextRound();
  const checkpoint = MovieProviderSearchProgressV4Schema.parse(
    structuredClone(progress.checkpoint()),
  );
  expect(checkpoint.paging?.listings).toHaveLength(2);
  expect(JSON.stringify(checkpoint)).not.toContain(first.title);
  expect(JSON.stringify(checkpoint)).not.toContain(first.download.value);
  progress = new MovieCandidateSearchProgress(criterion, checkpoint);
  const winner = { ...first, providerReleaseId: "winner" };
  await progress.recordPage(
    "knaben",
    {
      candidates: [first, winner],
      listingIds: ["first", "winner"],
      nextPage: 3,
    },
    cipher,
    rank,
  );
  expect(rank).toHaveBeenCalledTimes(3);
  progress.nextRound();
  await progress.recordPage(
    "knaben",
    {
      candidates: [winner, { ...first, title: "Changed source" }],
      listingIds: ["winner", "first"],
      nextPage: 4,
    },
    cipher,
    rank,
  );
  expect(progress.exhausted).toEqual(new Set(["knaben", "thepiratebay"]));
  expect(rank).toHaveBeenCalledTimes(3);
  expect(
    progress.results(Date.now()).candidates.map(({ rank: quality }) => quality),
  ).toEqual([2, 1]);
});

test("reassesses changed availability from a repeated page without counting the listing twice", async () => {
  const progress = new MovieCandidateSearchProgress(criterion);
  const candidate = {
    releaseId: crypto.randomUUID(),
    assessment: { id: crypto.randomUUID(), hash: criterion },
    rank: 1,
    score: 0,
    priority: 10,
  };
  const assess = (source: ProviderCandidate) =>
    Promise.resolve(source.seeders === 0 ? null : { candidate });
  await progress.recordPage(
    "knaben",
    { candidates: [first], listingIds: ["first"], nextPage: 2 },
    cipher,
    assess,
  );
  expect(progress.results(Date.now()).candidates).toEqual([candidate]);
  progress.nextRound();
  await progress.recordPage(
    "knaben",
    {
      candidates: [{ ...first, seeders: 0 }],
      listingIds: ["first"],
      nextPage: 3,
    },
    cipher,
    assess,
  );
  expect(progress.checkpoint().paging?.listings).toHaveLength(1);
  expect(progress.results(Date.now()).candidates).toEqual([]);
});

test.each([
  { pages: 10, pageSize: 100, listings: PROVIDER_SEARCH_MAX_LISTINGS },
  {
    pages: PROVIDER_SEARCH_MAX_PAGES,
    pageSize: 1,
    listings: PROVIDER_SEARCH_MAX_PAGES,
  },
])(
  "stops by $pages pages at $listings total listings",
  async ({ pages, pageSize, listings }) => {
    const progress = new MovieCandidateSearchProgress(criterion);
    for (let page = 1; page <= pages; page++) {
      expect(progress.atLimit).toBe(false);
      await progress.recordPage(
        "knaben",
        {
          candidates: [],
          listingIds: Array.from(
            { length: pageSize },
            (_, index) => `${String(page)}/${String(index)}`,
          ),
          nextPage: page + 1,
        },
        cipher,
        () => Promise.reject(new Error("Expected no mappable rows")),
      );
      if (page < pages) progress.nextRound();
    }
    expect(progress.atLimit).toBe(true);
    expect(progress.checkpoint().paging?.listings).toHaveLength(listings);
    expect(progress.checkpoint().paging?.pages).toHaveLength(pages);
  },
);

test("a later preferred release beats the fallback and waits only until its admission time", async () => {
  const start = 1000;
  const progress = new MovieCandidateSearchProgress(
    criterion,
    undefined,
    start,
  );
  const preferred = { ...first, providerReleaseId: "preferred" };
  const fallback = {
    releaseId: crypto.randomUUID(),
    assessment: { id: crypto.randomUUID(), hash: criterion },
    rank: 2,
    score: 100,
    priority: 1,
    fallbackDistanceBytes: 0,
  };
  const better = {
    releaseId: crypto.randomUUID(),
    assessment: { id: crypto.randomUUID(), hash: criterion },
    rank: 1,
    score: 0,
    priority: 50,
  };
  await progress.recordPage(
    "knaben",
    {
      candidates: [first],
      listingIds: ["first"],
      nextPage: 2,
      observedAt: start,
    },
    cipher,
    () => Promise.resolve({ candidate: fallback }),
  );
  progress.nextRound();
  await progress.recordPage(
    "knaben",
    {
      candidates: [preferred],
      listingIds: ["preferred"],
      nextPage: null,
      observedAt: start + 500,
    },
    cipher,
    () => Promise.resolve({ candidate: better, eligibleAt: start + 60_000 }),
  );
  const waiting = progress.results(start + 1000);
  expect(waiting.candidates).toEqual([fallback]);
  expect(progress.betterEligibleAt(fallback, start + 1000)).toBe(
    start + 60_000,
  );
  expect(progress.results(start + 60_000).candidates).toEqual([
    better,
    fallback,
  ]);
  expect(
    progress.results(start + PROVIDER_SEARCH_WINDOW_MS + 1).candidates,
  ).toEqual([better]);
});

test("a transient failure waits for one persisted retry while still reading other first pages", async () => {
  const start = 1000;
  let now = start;
  let progress = new MovieCandidateSearchProgress(criterion, undefined, now);
  const readPage = vi.fn((providerId: string) =>
    providerId === "knaben"
      ? Promise.reject(new IntegrationError(providerId, "unavailable"))
      : Promise.resolve({ candidates: [], listingIds: [], nextPage: null }),
  );
  const run = () =>
    collectProviderSearchRound({
      progress,
      providers: ["knaben", "thepiratebay"],
      cipher,
      now: () => now,
      readPage,
      assess: () => Promise.resolve(null),
    });
  const deferred = await run();
  expect(deferred?.retryAt.getTime()).toBe(start + 60_000);
  expect(readPage.mock.calls).toEqual([
    ["knaben", 1],
    ["thepiratebay", 1],
  ]);
  progress = new MovieCandidateSearchProgress(
    criterion,
    MovieProviderSearchProgressV4Schema.parse(progress.checkpoint()),
    now,
  );
  await run();
  expect(readPage).toHaveBeenCalledTimes(2);
  now = start + 60_000;
  expect(await run()).toBeUndefined();
  expect(readPage).toHaveBeenCalledTimes(3);
  expect(progress.exhausted).toEqual(new Set(["knaben", "thepiratebay"]));
});

test("a cooldown past the search deadline does not hold healthy provider paging", async () => {
  const start = 1000;
  const progress = new MovieCandidateSearchProgress(
    criterion,
    undefined,
    start,
  );
  const readPage = vi.fn((providerId: string, page: number) =>
    providerId === "knaben"
      ? Promise.reject(
          new ProviderAdmissionDeferred(
            providerId,
            new Date(start + PROVIDER_SEARCH_WINDOW_MS + 1000),
            "cooldown",
          ),
        )
      : Promise.resolve({
          candidates: [],
          listingIds: [String(page)],
          nextPage: page === 1 ? 2 : null,
        }),
  );
  const collect = () =>
    collectProviderSearchRound({
      progress,
      providers: ["knaben", "thepiratebay"],
      cipher,
      now: () => start,
      readPage,
      assess: () => Promise.resolve(null),
    });
  expect(await collect()).toBeUndefined();
  expect(progress.exhausted).toEqual(new Set(["knaben"]));
  progress.nextRound();
  expect(await collect()).toBeUndefined();
  expect(readPage.mock.calls).toEqual([
    ["knaben", 1],
    ["thepiratebay", 1],
    ["thepiratebay", 2],
  ]);
});
