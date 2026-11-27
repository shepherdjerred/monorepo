import type { CredentialCipher } from "#application/security.ts";
import { candidateSourceIdentity } from "#automation/candidate-evidence.ts";
import { compareProviderCandidates } from "#domain/provider-selection.ts";
import type { ProviderSearchPage } from "#integrations/providers.ts";
import type { TrackerProviderIdSchema } from "#shared/admin.ts";
import {
  MOVIE_DISCOVERY_LISTINGS,
  MOVIE_DISCOVERY_PAGES,
  type MovieProviderSearchProgressV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { MovieCandidateV4 } from "./candidates.ts";

type ProviderId = (typeof TrackerProviderIdSchema.options)[number];
type Paging = NonNullable<MovieProviderSearchProgressV4["paging"]>;
type Listing = Paging["listings"][number];
type Observation = Pick<Listing, "candidate" | "eligibleAt">;

/** Durable discovery state contains only digests, deadlines and assessment references. */
export class MovieCandidateSearchProgress {
  readonly exhausted: Set<ProviderId>;
  readonly completed: Set<ProviderId>;
  private readonly pages: Paging["pages"];
  private readonly listings: Map<string, Listing>;
  round: number;

  constructor(
    private readonly criteriaDigest: string,
    progress?: MovieProviderSearchProgressV4,
  ) {
    const previous =
      progress?.criteriaDigest === criteriaDigest ? progress : undefined;
    this.completed = new Set(previous?.completedProviderIds);
    this.exhausted = new Set(
      previous?.paging?.exhaustedProviderIds ?? previous?.completedProviderIds,
    );
    this.round = previous?.paging?.round ?? 1;
    this.pages = [...(previous?.paging?.pages ?? [])];
    this.listings = new Map(
      previous?.paging?.listings.map((listing) => [listing.digest, listing]),
    );
  }

  get atLimit() {
    return (
      this.pages.length >= MOVIE_DISCOVERY_PAGES ||
      this.listings.size >= MOVIE_DISCOVERY_LISTINGS
    );
  }

  settle(providerId: ProviderId) {
    this.completed.add(providerId);
    this.exhausted.add(providerId);
  }

  async recordPage(
    providerId: ProviderId,
    page: ProviderSearchPage,
    cipher: CredentialCipher,
    assess: (
      source: ProviderSearchPage["candidates"][number],
    ) => Promise<Observation | null>,
  ) {
    const rawIds = new Set(page.listingIds);
    if (page.nextPage !== null && page.nextPage !== this.round + 1)
      throw new Error("Movie provider returned a nonconsecutive search page");
    const digest = cipher.fingerprint(
      JSON.stringify([...rawIds].sort()),
      `movie-discovery-page:${providerId}`,
    );
    const repeated = this.pages.some(
      (entry) => entry.providerId === providerId && entry.digest === digest,
    );
    this.pages.push({ providerId, digest });
    this.completed.add(providerId);
    if (repeated || rawIds.size === 0 || page.nextPage === null)
      this.exhausted.add(providerId);
    for (const id of rawIds) {
      if (this.listings.size >= MOVIE_DISCOVERY_LISTINGS) break;
      const listingDigest = this.listingDigest(cipher, providerId, id);
      if (!this.listings.has(listingDigest))
        this.listings.set(listingDigest, { digest: listingDigest });
    }
    for (const source of page.candidates) {
      if (
        source.providerId !== providerId ||
        !rawIds.has(source.providerReleaseId)
      )
        throw new Error("Movie provider returned a source outside its page");
      await this.recordListing(source, cipher, assess);
    }
  }

  private async recordListing(
    source: ProviderSearchPage["candidates"][number],
    cipher: CredentialCipher,
    assess: (
      source: ProviderSearchPage["candidates"][number],
    ) => Promise<Observation | null>,
  ) {
    const digest = this.listingDigest(
      cipher,
      source.providerId,
      source.providerReleaseId,
    );
    const previous = this.listings.get(digest);
    if (previous === undefined || previous.sourceDigest === null) return;
    const sourceDigest = cipher.fingerprint(
      candidateSourceIdentity(source),
      "movie-discovery-source",
    );
    if (
      previous.sourceDigest !== undefined &&
      previous.sourceDigest !== sourceDigest
    ) {
      this.listings.set(digest, { digest, sourceDigest: null });
    } else if (
      previous.sourceDigest === undefined ||
      previous.seeders !== source.seeders
    ) {
      this.listings.set(digest, {
        digest,
        sourceDigest,
        seeders: source.seeders,
        ...(await assess(source)),
      });
    }
  }

  private listingDigest(
    cipher: CredentialCipher,
    providerId: ProviderId,
    id: string,
  ) {
    return cipher.fingerprint(id, `movie-discovery-listing:${providerId}`);
  }

  nextRound() {
    this.round++;
    this.completed.clear();
  }

  results(now: number) {
    const ranked: {
      candidate: MovieCandidateV4;
      seeders: Listing["seeders"];
    }[] = [];
    let earliest = Infinity;
    for (const listing of this.listings.values()) {
      if (listing.candidate === undefined) continue;
      if (listing.eligibleAt !== undefined && listing.eligibleAt > now)
        earliest = Math.min(earliest, listing.eligibleAt);
      else
        ranked.push({ candidate: listing.candidate, seeders: listing.seeders });
    }
    ranked.sort((left, right) =>
      compareProviderCandidates(
        {
          ...left.candidate,
          id: left.candidate.releaseId,
          seeders: left.seeders,
        },
        {
          ...right.candidate,
          id: right.candidate.releaseId,
          seeders: right.seeders,
        },
      ),
    );
    return { candidates: ranked.map(({ candidate }) => candidate), earliest };
  }

  checkpoint(): MovieProviderSearchProgressV4 {
    return {
      criteriaDigest: this.criteriaDigest,
      completedProviderIds: [...this.completed],
      paging: {
        schemaVersion: 1,
        round: this.round,
        exhaustedProviderIds: [...this.exhausted],
        pages: this.pages,
        listings: [...this.listings.values()],
      },
    };
  }
}
