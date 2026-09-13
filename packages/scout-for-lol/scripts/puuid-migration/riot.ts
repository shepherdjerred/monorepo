/**
 * Riot Account API access for the migration's two hops, each on its own key
 * and its own rate budget.
 */

import { z } from "zod";
import { env, NEW_KEY_LIMITS, OLD_KEY_LIMITS } from "./support.ts";

const AccountSchema = z.object({
  puuid: z.string().min(1),
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
});

export type RiotAccount = z.infer<typeof AccountSchema>;

class RateLimiter {
  readonly #perSecond: number;
  readonly #perTwoMinutes: number;
  #recent: number[] = [];

  constructor(limits: { perSecond: number; perTwoMinutes: number }) {
    this.#perSecond = limits.perSecond;
    this.#perTwoMinutes = limits.perTwoMinutes;
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.#recent = this.#recent.filter((t) => now - t < 120_000);
      const lastSecond = this.#recent.filter((t) => now - t < 1000).length;
      if (
        lastSecond < this.#perSecond &&
        this.#recent.length < this.#perTwoMinutes
      ) {
        this.#recent.push(now);
        return;
      }
      await Bun.sleep(250);
    }
  }
}

const oldLimiter = new RateLimiter(OLD_KEY_LIMITS);
const newLimiter = new RateLimiter(NEW_KEY_LIMITS);

/**
 * A 404 means Riot genuinely has no account — renamed, transferred, or
 * deleted. That is data, recorded as `unresolved`, not a failure to retry.
 * Every other non-200 is a real fault and stops the run: silently skipping
 * would strand identities we can never recover once the old key is gone.
 */
async function riotGet(
  path: string,
  key: string,
  limiter: RateLimiter,
): Promise<RiotAccount | null> {
  for (let attempt = 0; ; attempt++) {
    await limiter.take();
    const response = await fetch(
      `https://${env.ACCOUNT_ROUTE}.api.riotgames.com${path}`,
      { headers: { "X-Riot-Token": key } },
    );

    if (response.status === 200) {
      const body: unknown = await response.json();
      return AccountSchema.parse(body);
    }
    if (response.status === 404) {
      return null;
    }
    if (response.status === 429 && attempt < 5) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "10");
      console.warn(`  429 received; sleeping ${retryAfter.toString()}s`);
      await Bun.sleep(retryAfter * 1000);
      continue;
    }
    const text = await response.text();
    throw new Error(
      `Riot ${path} failed: HTTP ${response.status.toString()} ${text}`,
    );
  }
}

/** Old PUUID to Riot ID, under the key that minted the PUUID. */
export const byPuuid = (puuid: string): Promise<RiotAccount | null> =>
  riotGet(
    `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
    env.OLD_RIOT_API_KEY,
    oldLimiter,
  );

/** Riot ID to new PUUID, under the key we are migrating to. */
export const byRiotId = (
  gameName: string,
  tagLine: string,
): Promise<RiotAccount | null> =>
  riotGet(
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    env.NEW_RIOT_API_KEY,
    newLimiter,
  );
