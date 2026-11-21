import type { PromotionBrowserOptions } from "./browser-profile.ts";
import {
  assertRedditBrowserAccess,
  RedditBrowserReadError,
} from "#activities/promotion/reddit-discovery/browser-reader.ts";
import { redditBrowserAccessScript } from "#activities/promotion/reddit-discovery/browser-scripts.ts";
import { markRedditAccountFailureRecorded } from "#activities/promotion/reddit-outreach/ownership.ts";

/** Once access fails this browser can only dispose its owned tab. */
export class RedditBrowserAccount {
  readonly options: PromotionBrowserOptions;
  private stopped: RedditBrowserReadError | undefined;
  constructor(options: PromotionBrowserOptions) {
    const account = options.redditAccount;
    this.options =
      account === undefined
        ? options
        : {
            ...options,
            redditAccount: {
              success: account.success,
              failure: async (failure) => {
                await account.failure(failure);
                this.stopped = new RedditBrowserReadError(
                  failure.kind === "logged-out" ? "identity" : failure.kind,
                  "Reddit account access failed; this browser task is stopped",
                  failure.retryAt,
                );
                markRedditAccountFailureRecorded(this.stopped);
              },
            },
          };
  }
  assertRequest(suffix: string) {
    if (
      this.stopped !== undefined &&
      !/^\/instances\/[^/]+\/tabs$|\/tabs\/[^/]+\/close$/.test(suffix)
    )
      throw this.stopped;
  }
}

export async function reportRedditBrowserFailure(
  options: PromotionBrowserOptions,
  error: RedditBrowserReadError,
) {
  const account = options.redditAccount;
  if (account === undefined || error.kind === "page" || error.kind === "cursor")
    return;
  await account.failure({
    kind: error.kind === "identity" ? "logged-out" : error.kind,
    retryAt: error.retryAt,
  });
  markRedditAccountFailureRecorded(error);
}

export async function checkRedditAccountRead(input: {
  options: PromotionBrowserOptions;
  scan: () => Promise<unknown>;
  evaluate: (script: string) => Promise<unknown>;
}) {
  if (input.options.redditAccount === undefined) return;
  await input.scan();
  try {
    assertRedditBrowserAccess(
      await input.evaluate(redditBrowserAccessScript),
      "the_storm_mc",
    );
  } catch (error) {
    if (error instanceof RedditBrowserReadError)
      await reportRedditBrowserFailure(input.options, error);
    throw error;
  }
  await input.options.redditAccount.success();
}

export function redditBrowserRateLimit(
  retryAfter: string | null,
  now = Date.now(),
) {
  const seconds =
    retryAfter === null || retryAfter.trim() === ""
      ? Number.NaN
      : Number(retryAfter);
  const deadline =
    Number.isFinite(seconds) && seconds >= 0
      ? now + seconds * 1000
      : Date.parse(retryAfter ?? "");
  const retryAt =
    Number.isFinite(deadline) && Math.abs(deadline) <= 8_640_000_000_000_000
      ? new Date(deadline).toISOString()
      : null;
  return new RedditBrowserReadError(
    "rate-limit",
    "Reddit browser returned HTTP 429",
    retryAt,
  );
}
