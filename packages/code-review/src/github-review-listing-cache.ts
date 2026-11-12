/**
 * Reusing a review listing while GitHub reports nothing that could change it.
 *
 * The review gate polls every 30 seconds, and each poll used to re-read the
 * pull request's review threads and reviews over GraphQL: two queries per
 * enabled provider, so about eight points a minute for each open pull request.
 * GraphQL has no conditional requests, so an unchanged pull request cost the
 * same as a busy one. With thirty pull requests waiting at once, that is about
 * 14,400 points an hour against a 5,000-point bucket.
 *
 * The REST views of the same records do support conditional requests, and an
 * unchanged page comes back as an uncharged `304`. So the listing is fetched
 * again only when one of those views changes, plus a slow safety re-list for
 * the one change no REST view records: a thread being resolved or unresolved.
 *
 * Reuse only ever delays what the gate sees; it never decides a terminal
 * outcome. A pass is re-read fresh before it is accepted, and the gate re-reads
 * the listing before failing on a reused one (see `review-gate-poll.ts`).
 */

import { createHash } from "node:crypto";
import { GITHUB_API_URL } from "./github-http.ts";
import { githubGet, restCache } from "./github-request.ts";
import {
  fetchReviewListing,
  type ReviewListing,
} from "./github-review-snapshot.ts";

/**
 * How long a reused listing may stand without a REST change. It bounds how
 * late the gate notices a thread resolved or unresolved, since no REST view
 * records that. One re-list costs two GraphQL points, so this period is most of
 * an idle gate's hourly GraphQL cost.
 */
export const REVIEW_LISTING_MAX_AGE_MS = 5 * 60 * 1000;

type ListingInput = { repo: string; number: number; token: string };

/**
 * The REST views that change whenever the listing's review threads or reviews
 * change. Reviews cover a review being submitted, edited, or dismissed; review
 * comments, newest update first, cover a finding being posted or edited. Both
 * are read every poll through the shared ETag cache, so an unchanged pull
 * request answers with `304`s that GitHub does not charge.
 */
export function reviewListingSignalUrls(
  repo: string,
  number: number,
): string[] {
  const pull = `${GITHUB_API_URL}/repos/${repo}/pulls/${String(number)}`;
  return [
    `${pull}/reviews?per_page=100`,
    `${pull}/comments?sort=updated&direction=desc&per_page=1`,
  ];
}

/** A digest of the change-signal views' current bodies. */
export async function reviewListingChangeSignal(
  input: ListingInput,
): Promise<string> {
  const digest = createHash("sha256");
  for (const url of reviewListingSignalUrls(input.repo, input.number)) {
    const response = await githubGet(url, {
      token: input.token,
      cache: restCache,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `GitHub API request failed with ${String(response.status)} ${response.statusText}: ${body}`,
      );
    }
    digest.update(url).update("\0").update(body).update("\0");
  }
  return digest.digest("hex");
}

type HeldListing = {
  key: string;
  signal: string;
  fetchedAt: number;
  tick: number;
  listing: ReviewListing;
};

export type ReviewListingSource = (
  input: ListingInput,
) => Promise<ReviewListing>;

/**
 * One gate run's listing, re-fetched only when its change signal moves or it
 * reaches {@link REVIEW_LISTING_MAX_AGE_MS}.
 *
 * The signal is read before the listing is fetched, so a change landing in
 * between leaves the held signal older than the listing and forces another
 * fetch next time; it can never hide a change.
 */
export class ReviewListingCache {
  readonly #maxAgeMs: number;
  readonly #now: () => number;
  readonly #fetch: ReviewListingSource;
  readonly #signal: (input: ListingInput) => Promise<string>;
  #held: HeldListing | null = null;
  #tick = 0;
  #reusedEarlierTick = false;
  /** Listings fetched over GraphQL. */
  fetched = 0;
  /** Requests answered with a held listing. */
  reused = 0;

  constructor(
    options: {
      maxAgeMs?: number;
      now?: () => number;
      fetch?: ReviewListingSource;
      signal?: (input: ListingInput) => Promise<string>;
    } = {},
  ) {
    this.#maxAgeMs = options.maxAgeMs ?? REVIEW_LISTING_MAX_AGE_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#fetch = options.fetch ?? fetchReviewListing;
    this.#signal = options.signal ?? reviewListingChangeSignal;
  }

  /**
   * Start a poll tick. Providers within one tick share a listing; whether a
   * listing from an EARLIER tick was reused is reported by
   * {@link reusedEarlierTick}.
   */
  beginTick(): void {
    this.#tick++;
    this.#reusedEarlierTick = false;
  }

  /** Whether this tick reused a listing fetched in an earlier tick. */
  get reusedEarlierTick(): boolean {
    return this.#reusedEarlierTick;
  }

  /** Drop the held listing so the next request fetches a fresh one. */
  invalidate(): void {
    this.#held = null;
  }

  async get(input: ListingInput): Promise<ReviewListing> {
    const key = `${input.repo}#${String(input.number)}`;
    const signal = await this.#signal(input);
    const now = this.#now();
    const held = this.#held;
    if (
      held !== null &&
      held.key === key &&
      held.signal === signal &&
      now - held.fetchedAt < this.#maxAgeMs
    ) {
      this.reused++;
      if (held.tick !== this.#tick) this.#reusedEarlierTick = true;
      return held.listing;
    }
    const listing = await this.#fetch(input);
    this.fetched++;
    this.#held = { key, signal, fetchedAt: now, tick: this.#tick, listing };
    return listing;
  }
}
