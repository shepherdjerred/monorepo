/**
 * Riot Account API access for the migration's two hops, each on its own key
 * and its own rate budget.
 */

import { z } from "zod";
import { minutesFor, parseRateLimitHeader, RateLimiter } from "./rate-limit.ts";
import {
  accountRoute,
  NEW_KEY_PUBLISHED,
  OLD_KEY_PUBLISHED,
  riotKeys,
} from "./support.ts";

const AccountSchema = z.object({
  puuid: z.string().min(1),
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
});

export type RiotAccount = z.infer<typeof AccountSchema>;

function limiterFor(
  label: string,
  published: { app: string; method: string },
): RateLimiter {
  return new RateLimiter(label, [
    ...parseRateLimitHeader(published.app, "app"),
    ...parseRateLimitHeader(published.method, "method"),
  ]);
}

const oldLimiter = limiterFor("old key", OLD_KEY_PUBLISHED);
const newLimiter = limiterFor("new key", NEW_KEY_PUBLISHED);

/**
 * Wait out a full window on each key before the first request of a run.
 *
 * Only the long-running phases need this. A restarted process cannot know how
 * much of a window its predecessor spent, and the harvest is supervised by
 * something that restarts it on every crash.
 */
export async function waitOutColdStart(): Promise<void> {
  await Promise.all([
    oldLimiter.waitOutColdStart(),
    newLimiter.waitOutColdStart(),
  ]);
}

/** How long to wait before retrying a transient failure, capped. */
function backoffMs(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
}

type Outcome =
  | { kind: "account"; account: RiotAccount }
  | { kind: "absent" }
  | { kind: "retry"; waitMs: number; why: string };

/**
 * Classify one response.
 *
 * A 404 is DATA: Riot genuinely has no account under that identifier, because
 * it was renamed, transferred or deleted. It is recorded, not retried.
 *
 * 429 and 5xx are weather. This job runs for days across a laptop's sleeps and
 * network changes, so transient failures must not end it — they back off and
 * retry without limit.
 *
 * Every other 4xx is a fault in the request or the key. Retrying cannot fix a
 * revoked key or a malformed identifier, and doing so forever would turn a
 * loud, fixable problem into a silent stall.
 */
async function classify(response: Response, attempt: number): Promise<Outcome> {
  if (response.status === 200) {
    const body: unknown = await response.json();
    return { kind: "account", account: AccountSchema.parse(body) };
  }
  if (response.status === 404) {
    return { kind: "absent" };
  }
  if (response.status === 400) {
    // Riot answers a token it cannot decrypt with 400, not 404. That is an
    // answer about the token — it does not belong to this key's domain — and
    // the commonest cause is a perfectly valid identifier minted under the
    // OTHER key, which is what every object written since the cutover carries.
    //
    // Treating it as a fault killed the run: the process exited, the supervisor
    // restarted it, and it spent ten minutes on a cold-start wait before
    // reaching the next such token. A malformed request is still a fault, so
    // only the decryption message is read as data.
    const text = await response.text();
    if (text.includes("decrypting")) {
      return { kind: "absent" };
    }
    throw new Error(`Riot rejected the request: HTTP 400 ${text}`);
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "10");
    return {
      kind: "retry",
      waitMs: (Number.isFinite(retryAfter) ? retryAfter : 10) * 1000,
      why: "429 rate limited",
    };
  }
  if (response.status >= 500) {
    return {
      kind: "retry",
      waitMs: backoffMs(attempt),
      why: `HTTP ${response.status.toString()}`,
    };
  }
  const text = await response.text();
  throw new Error(
    `Riot request failed unrecoverably: HTTP ${response.status.toString()} ${text}`,
  );
}

async function riotGet(
  path: string,
  key: string,
  limiter: RateLimiter,
): Promise<RiotAccount | null> {
  for (let attempt = 0; ; attempt++) {
    await limiter.take();

    let response: Response;
    try {
      response = await fetch(
        `https://${accountRoute()}.api.riotgames.com${path}`,
        { headers: { "X-Riot-Token": key } },
      );
    } catch (error) {
      // A dropped connection is expected on a laptop that sleeps or roams
      // between networks. Wait and try the same identity again.
      const wait = backoffMs(attempt);
      console.warn(
        `  network error (${String(error)}); retrying in ${(wait / 1000).toString()}s`,
      );
      await Bun.sleep(wait);
      continue;
    }

    limiter.adopt(
      response.headers.get("x-app-rate-limit"),
      response.headers.get("x-method-rate-limit"),
    );
    limiter.observeUsage(
      response.headers.get("x-app-rate-limit-count"),
      response.headers.get("x-method-rate-limit-count"),
    );

    const outcome = await classify(response, attempt);
    if (outcome.kind === "account") {
      return outcome.account;
    }
    if (outcome.kind === "absent") {
      return null;
    }
    console.warn(
      `  ${outcome.why}; retrying in ${(outcome.waitMs / 1000).toString()}s`,
    );
    await Bun.sleep(outcome.waitMs);
  }
}

/** Old PUUID to Riot ID, under the key that minted the PUUID. */
export const byPuuid = (puuid: string): Promise<RiotAccount | null> =>
  riotGet(
    `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
    riotKeys().old,
    oldLimiter,
  );

/** Riot ID to new PUUID, under the key we are migrating to. */
export const byRiotId = (
  gameName: string,
  tagLine: string,
): Promise<RiotAccount | null> =>
  riotGet(
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    riotKeys().fresh,
    newLimiter,
  );

/** Minutes the old-key hop will take for `count` identities, at its budget. */
export const estimateOldKeyMinutes = (count: number): number =>
  minutesFor(count, oldLimiter.windows);

/** Minutes the new-key hop will take for `count` identities, at its budget. */
export const estimateNewKeyMinutes = (count: number): number =>
  minutesFor(count, newLimiter.windows);

/** Exposed for tests: the response classification, without the network. */
export const classifyForTest = classify;
