import type { CredentialCipher } from "#application/security.ts";
import { candidateSourceIdentity } from "#automation/candidate-evidence.ts";
import { compareProviderCandidates } from "#domain/provider-selection.ts";
import type { ProviderSearchPage } from "#integrations/providers.ts";
import type { TrackerProviderIdSchema } from "#shared/admin.ts";
import {
  PROVIDER_SEARCH_MAX_LISTINGS,
  PROVIDER_SEARCH_MAX_PAGES,
  PROVIDER_SEARCH_WINDOW_MS,
  type EpisodeProviderSearchProgress,
} from "#shared/acquisition/provider-search.ts";
import { IntegrationError } from "#integrations/http.ts";
import { ProviderAdmissionDeferred } from "#automation/providers.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PROVIDER_AVAILABILITY_MAX_AGE_MS } from "#domain/provider-availability.ts";
import { readFeedSourceV1 } from "#automation/feeds/source.ts";
import { MediaError } from "#application/errors.ts";

type ProviderId = (typeof TrackerProviderIdSchema.options)[number];
type BasePaging = NonNullable<EpisodeProviderSearchProgress["paging"]>;
type BaseListing = BasePaging["listings"][number];
type RankedCandidate = NonNullable<BaseListing["candidate"]>;
type Listing<Candidate> = Omit<BaseListing, "candidate"> & {
  candidate?: Candidate | undefined;
};
type Progress<Candidate> = Omit<EpisodeProviderSearchProgress, "paging"> & {
  paging?:
    | (Omit<BasePaging, "listings"> & { listings: Listing<Candidate>[] })
    | undefined;
};
type Observation<Candidate> = Pick<
  Listing<Candidate>,
  "candidate" | "eligibleAt"
>;
const rank = <Candidate extends RankedCandidate>(
  left: Candidate,
  right: Candidate,
) =>
  compareProviderCandidates(
    { ...left, id: left.releaseId },
    { ...right, id: right.releaseId },
  );

/** Durable discovery state contains only digests, deadlines and assessment references. */
export class CandidateSearchProgress<Candidate extends RankedCandidate> {
  readonly exhausted: Set<ProviderId>;
  readonly completed: Set<ProviderId>;
  private readonly pages: BasePaging["pages"];
  private readonly listings: Map<string, Listing<Candidate>>;
  private readonly startedAt: number | undefined;
  private readonly retries: Map<ProviderId, number>;
  round: number;

  constructor(
    private readonly criteriaDigest: string,
    progress?: Progress<Candidate>,
    startWindowAt?: number,
  ) {
    const previous =
      progress?.criteriaDigest === criteriaDigest ? progress : undefined;
    const paging = previous?.paging;
    this.completed = new Set(previous?.completedProviderIds);
    this.exhausted = new Set(
      paging?.exhaustedProviderIds ?? previous?.completedProviderIds,
    );
    this.round = paging?.round ?? 1;
    this.pages = [...(paging?.pages ?? [])];
    this.listings = new Map(
      paging?.listings.map((listing) => [listing.digest, listing]),
    );
    this.startedAt = paging?.startedAt ?? startWindowAt;
    this.retries = new Map(
      paging?.retries?.map(({ providerId, retryAt }) => [providerId, retryAt]),
    );
  }

  get atLimit() {
    return (
      this.pages.length >= PROVIDER_SEARCH_MAX_PAGES ||
      this.listings.size >= PROVIDER_SEARCH_MAX_LISTINGS
    );
  }

  get deadline() {
    return this.startedAt === undefined
      ? Infinity
      : this.startedAt + PROVIDER_SEARCH_WINDOW_MS;
  }

  retryAt(providerId: ProviderId) {
    return this.retries.get(providerId);
  }

  /** Transport-level transient failure may consume one retry per provider. */
  retryFailure(providerId: ProviderId, error: IntegrationError, now: number) {
    if (
      this.startedAt === undefined ||
      this.retries.has(providerId) ||
      (error.kind !== "unavailable" && error.kind !== "rate-limited")
    )
      return;
    const retryAt = now + Math.max(60, error.retryAfterSeconds ?? 60) * 1000;
    if (retryAt >= this.deadline) return;
    this.retries.set(providerId, retryAt);
    return retryAt;
  }

  settle(providerId: ProviderId) {
    this.completed.add(providerId);
    this.exhausted.add(providerId);
  }

  async recordPage(
    providerId: ProviderId,
    page: ProviderSearchPage & { observedAt?: number | undefined },
    cipher: CredentialCipher,
    assess: (
      source: ProviderSearchPage["candidates"][number],
    ) => Promise<Observation<Candidate> | null>,
  ) {
    if (page.candidates.length > 100 || page.listingIds.length > 100)
      throw new MediaError(
        "movie_candidate_limit",
        "Provider search exceeded its candidate bound",
        422,
      );
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
      if (this.listings.size >= PROVIDER_SEARCH_MAX_LISTINGS) break;
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
      await this.recordListing(source, cipher, assess, page.observedAt);
    }
  }

  async recordFeed(
    source: ProviderSearchPage["candidates"][number],
    cipher: CredentialCipher,
    assess: (
      source: ProviderSearchPage["candidates"][number],
    ) => Promise<Observation<Candidate> | null>,
    now: number,
  ) {
    if (this.atLimit || source.availabilityObservedAtV1 === undefined) return;
    const observedAt = Date.parse(source.availabilityObservedAtV1);
    if (observedAt > now || now - observedAt > PROVIDER_AVAILABILITY_MAX_AGE_MS)
      return;
    const digest = this.listingDigest(
      cipher,
      source.providerId,
      source.providerReleaseId,
    );
    if (this.listings.has(digest)) return;
    this.listings.set(digest, { digest });
    await this.recordListing(source, cipher, assess, observedAt);
  }

  private async recordListing(
    source: ProviderSearchPage["candidates"][number],
    cipher: CredentialCipher,
    assess: (
      source: ProviderSearchPage["candidates"][number],
    ) => Promise<Observation<Candidate> | null>,
    observedAt?: number,
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
      previous.seeders !== source.seeders ||
      (observedAt !== undefined && observedAt > (previous.observedAt ?? 0))
    ) {
      this.listings.set(digest, {
        digest,
        sourceDigest,
        seeders: source.seeders,
        ...(observedAt === undefined ? {} : { observedAt }),
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
    const candidates: Candidate[] = [];
    let earliest = Infinity;
    for (const listing of this.listings.values()) {
      if (listing.candidate === undefined || !this.fresh(listing, now))
        continue;
      if (listing.eligibleAt !== undefined && listing.eligibleAt > now)
        earliest = Math.min(earliest, listing.eligibleAt);
      else candidates.push(listing.candidate);
    }
    candidates.sort(rank);
    return { candidates, earliest };
  }

  betterEligibleAt(candidate: Candidate | undefined, now: number) {
    let earliest = Infinity;
    for (const listing of this.listings.values()) {
      if (
        listing.candidate !== undefined &&
        this.fresh(listing, now) &&
        listing.eligibleAt !== undefined &&
        listing.eligibleAt > now &&
        (candidate === undefined || rank(listing.candidate, candidate) < 0)
      )
        earliest = Math.min(earliest, listing.eligibleAt);
    }
    return earliest;
  }

  private fresh(listing: Listing<Candidate>, now: number) {
    return (
      this.startedAt === undefined ||
      listing.observedAt === undefined ||
      now - listing.observedAt <= PROVIDER_AVAILABILITY_MAX_AGE_MS
    );
  }

  checkpoint(): Progress<Candidate> {
    return {
      criteriaDigest: this.criteriaDigest,
      completedProviderIds: [...this.completed],
      paging: {
        schemaVersion: 1,
        round: this.round,
        exhaustedProviderIds: [...this.exhausted],
        pages: this.pages,
        listings: [...this.listings.values()],
        ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }),
        ...(this.retries.size === 0
          ? {}
          : {
              retries: [...this.retries].map(([providerId, retryAt]) => ({
                providerId,
                retryAt,
              })),
            }),
      },
    };
  }
}

type SearchRound<Candidate extends RankedCandidate> = {
  progress: CandidateSearchProgress<Candidate>;
  providers: readonly ProviderId[];
  cipher: CredentialCipher;
  now: () => number;
  readPage: (
    providerId: ProviderId,
    round: number,
  ) => Promise<ProviderSearchPage>;
  assess: (
    source: ProviderSearchPage["candidates"][number],
  ) => Promise<Observation<Candidate> | null>;
};

export async function collectProviderSearchRound<
  Candidate extends RankedCandidate,
>(input: SearchRound<Candidate>) {
  const { progress, providers, now } = input;
  let deferred: ProviderAdmissionDeferred | undefined;
  for (const providerId of providers) {
    if (progress.atLimit || now() >= progress.deadline) break;
    if (
      progress.completed.has(providerId) ||
      progress.exhausted.has(providerId)
    )
      continue;
    const wait = await readRoundProvider(input, providerId);
    if (
      wait !== null &&
      wait.retryAt.getTime() < (deferred?.retryAt.getTime() ?? Infinity)
    )
      deferred = wait;
  }
  return deferred;
}

async function readRoundProvider<Candidate extends RankedCandidate>(
  { progress, cipher, now, readPage, assess }: SearchRound<Candidate>,
  providerId: ProviderId,
) {
  const retryAt = progress.retryAt(providerId);
  if (retryAt !== undefined && retryAt > now())
    return new ProviderAdmissionDeferred(
      providerId,
      new Date(retryAt),
      "cooldown",
    );
  try {
    const page = await readPage(providerId, progress.round);
    await progress.recordPage(
      providerId,
      {
        ...page,
        observedAt: Number.isFinite(progress.deadline) ? now() : undefined,
      },
      cipher,
      assess,
    );
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    const providerRetryAt =
      error instanceof ProviderAdmissionDeferred
        ? error.retryAt.getTime()
        : progress.retryFailure(providerId, error, now());
    if (providerRetryAt !== undefined && providerRetryAt < progress.deadline)
      return error instanceof ProviderAdmissionDeferred
        ? error
        : new ProviderAdmissionDeferred(
            providerId,
            new Date(providerRetryAt),
            "cooldown",
          );
    progress.settle(providerId);
  }
  return null;
}

/** Network activities advance the machine; Workflows persist and schedule its timers. */
export async function providerSearchTransition<
  Candidate extends RankedCandidate,
>(
  progress: CandidateSearchProgress<Candidate>,
  input: {
    db: MediaAutomationContext["db"];
    providers: readonly ProviderId[];
    deferred: ProviderAdmissionDeferred | undefined;
    now: number;
  },
) {
  const { db, providers, deferred, now } = input;
  if (!progress.atLimit && now < progress.deadline) {
    if (deferred !== undefined)
      return {
        state: "waiting-for-provider" as const,
        retryAt: Math.min(deferred.retryAt.getTime(), progress.deadline),
      };
    const next = providers.filter((id) => !progress.exhausted.has(id));
    if (next.length > 0) {
      progress.nextRound();
      const leases = await db.providerLease.findMany({
        where: { providerId: { in: next } },
        select: { providerId: true, nextAllowedAt: true },
      });
      const deadlines = new Map(
        leases.map(({ providerId, nextAllowedAt }) => [
          providerId,
          nextAllowedAt.getTime(),
        ]),
      );
      return {
        state: "waiting-for-provider" as const,
        retryAt: Math.min(
          progress.deadline,
          ...next.map((id) => deadlines.get(id) ?? now),
        ),
      };
    }
  }
  const { candidates, earliest } = progress.results(now);
  const betterEligibleAt = progress.betterEligibleAt(candidates[0], now);
  if (
    Number.isFinite(progress.deadline) &&
    betterEligibleAt < progress.deadline
  )
    return {
      state: "waiting-for-provider" as const,
      retryAt: betterEligibleAt,
    };
  return { state: "selecting" as const, candidates, earliest };
}

export async function includeFeedObservation<Candidate extends RankedCandidate>(
  progress: CandidateSearchProgress<Candidate>,
  input: Pick<
    SearchRound<Candidate>,
    "providers" | "cipher" | "assess" | "now"
  > & {
    db: MediaAutomationContext["db"];
    feedSourceId?: string | undefined;
  },
) {
  const { db, cipher, assess, providers, now, feedSourceId } = input;
  if (feedSourceId === undefined || !Number.isFinite(progress.deadline)) return;
  const source = await readFeedSourceV1(db, cipher, feedSourceId);
  if (providers.includes(source.providerId))
    await progress.recordFeed(source, cipher, assess, now());
}
