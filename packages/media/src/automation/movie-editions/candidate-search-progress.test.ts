import { expect, test, vi } from "vitest";
import { CredentialCipher } from "#application/security.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import {
  MOVIE_DISCOVERY_LISTINGS,
  MOVIE_DISCOVERY_PAGES,
  MovieProviderSearchProgressV4Schema,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
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

test("prefers the better-seeded equal release after resuming a search", async () => {
  const progress = new MovieCandidateSearchProgress(criterion);
  const singleSeed = "00000000-0000-4000-8000-000000000001";
  const multipleSeeds = "00000000-0000-4000-8000-000000000002";
  const lowerScore = "00000000-0000-4000-8000-000000000003";
  const rank = (source: ProviderCandidate) =>
    Promise.resolve({
      candidate: {
        releaseId: source.providerReleaseId,
        assessment: { id: crypto.randomUUID(), hash: criterion },
        rank: 1,
        score: source.providerReleaseId === lowerScore ? 0 : 1,
        priority: 25,
      },
    });
  await progress.recordPage(
    "knaben",
    {
      candidates: [
        { ...first, providerReleaseId: singleSeed, seeders: 1 },
        { ...first, providerReleaseId: multipleSeeds, seeders: 3 },
        { ...first, providerReleaseId: lowerScore, seeders: 100 },
      ],
      listingIds: [singleSeed, multipleSeeds, lowerScore],
      nextPage: null,
    },
    cipher,
    rank,
  );
  const restored = new MovieCandidateSearchProgress(
    criterion,
    MovieProviderSearchProgressV4Schema.parse(progress.checkpoint()),
  );
  expect(
    restored.results(Date.now()).candidates.map(({ releaseId }) => releaseId),
  ).toEqual([multipleSeeds, singleSeed, lowerScore]);
});

test.each([
  { pages: 10, pageSize: 100, listings: MOVIE_DISCOVERY_LISTINGS },
  {
    pages: MOVIE_DISCOVERY_PAGES,
    pageSize: 1,
    listings: MOVIE_DISCOVERY_PAGES,
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
