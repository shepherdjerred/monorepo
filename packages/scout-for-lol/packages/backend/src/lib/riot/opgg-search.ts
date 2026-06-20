/**
 * Partial-name summoner suggestions by proxying OP.GG's own search.
 *
 * Riot's official API has NO partial/username search — only exact Riot-ID
 * resolution. OP.GG runs its own crawled summoner index, exposed (on the web)
 * as a Next.js **Server Action**: POST `/` with a `next-action` id header and
 * a JSON body, returning an RSC stream. We replicate that request here.
 *
 * ⚠️ Unofficial + brittle: the `next-action` id is tied to OP.GG's current
 * build and changes on every deploy. When it goes stale this call fails and we
 * fall back to `[]` (the add-player field still works via our own index + the
 * Riot exact-resolve path). OP.GG data is never persisted unverified — every
 * pick is re-confirmed through Riot before storage.
 *
 * Captured 2026-06-19. If OP.GG suggestions stop appearing, re-capture the
 * request from op.gg devtools (Network → the POST to `/` with `next-action`)
 * and update OPGG_ACTION_ID / OPGG_ROUTER_STATE below.
 */

import { z } from "zod";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("opgg-search");

const OPGG_URL = "https://op.gg/";
const OPGG_ACTION_ID = "402c9587dc35c9a189a48efae20bebb24826369a95";
const OPGG_ROUTER_STATE =
  "%5B%22%22%2C%7B%22children%22%3A%5B%5B%22locale%22%2C%22en%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22lol%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D";
const TIMEOUT_MS = 4000;
const MAX_RESULTS = 10;

/** Our RegionSchema values → OP.GG's region tokens. */
const REGION_TO_OPGG: Record<string, string> = {
  AMERICA_NORTH: "na",
  EU_WEST: "euw",
  EU_EAST: "eune",
  KOREA: "kr",
  JAPAN: "jp",
  BRAZIL: "br",
  LAT_NORTH: "lan",
  LAT_SOUTH: "las",
  OCEANIA: "oce",
  TURKEY: "tr",
  RUSSIA: "ru",
  VIETNAM: "vn",
  TAIWAN: "tw",
  SINGAPORE: "sg",
};

export type OpggSuggestion = {
  gameName: string;
  tagLine: string;
  region: string;
  tier: string | null;
};

const OpggSummonerSchema = z.object({
  gameName: z.string().min(1),
  tagline: z.string().min(1),
  ranked: z.string().nullable().optional(),
});
const OpggDataSchema = z.object({ summoners: z.array(OpggSummonerSchema) });
type OpggSummoner = z.infer<typeof OpggSummonerSchema>;

/**
 * The response is an RSC line stream (`<id>:<json>`). Find the line whose JSON
 * validates as the `{summoners:[...]}` payload and return its summoners.
 * Exported for testing.
 */
export function extractSummoners(body: string): OpggSummoner[] {
  for (const line of body.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(colon + 1));
    } catch {
      continue;
    }
    const result = OpggDataSchema.safeParse(parsed);
    if (result.success) return result.data.summoners;
  }
  return [];
}

/**
 * Search OP.GG for summoners whose name starts with `query` in `region` (our
 * RegionSchema value). Fail-soft: returns `[]` on any error/timeout/parse
 * failure / unmappable region.
 */
export async function opggSearch(
  query: string,
  region: string,
): Promise<OpggSuggestion[]> {
  const trimmed = query.trim();
  const opggRegion = REGION_TO_OPGG[region];
  if (trimmed.length < 2 || opggRegion === undefined) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const response = await fetch(OPGG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        Accept: "text/x-component",
        Origin: "https://op.gg",
        Referer: "https://op.gg/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15",
        "next-action": OPGG_ACTION_ID,
        "next-router-state-tree": OPGG_ROUTER_STATE,
      },
      body: JSON.stringify([
        { region: opggRegion, value: trimmed, locale: "en" },
      ]),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn("OP.GG search returned non-OK", { status: response.status });
      return [];
    }
    return extractSummoners(await response.text())
      .slice(0, MAX_RESULTS)
      .map((summoner) => ({
        gameName: summoner.gameName,
        tagLine: summoner.tagline,
        region,
        tier: summoner.ranked ?? null,
      }));
  } catch (error) {
    logger.warn("OP.GG search failed", { error });
    return [];
  } finally {
    clearTimeout(timer);
  }
}
