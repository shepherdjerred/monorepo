/**
 * Partial-name summoner suggestions by proxying OP.GG's own search.
 *
 * Riot's official API has NO partial/username search — only exact Riot-ID
 * resolution. OP.GG runs its own crawled summoner index, exposed (on the web)
 * as a Next.js **Server Action**: POST `/` with a `next-action` id header and
 * a JSON body, returning an RSC stream. We replicate that request here.
 *
 * The `next-action` id is tied to OP.GG's build. **In practice old ids keep
 * working across OP.GG deploys** (observed: the seed id below still resolved
 * after OP.GG shipped a new bundle), so `OPGG_ACTION_ID` is fairly resilient
 * on its own. As a **best-effort** fallback, if the cached id ever stops
 * working we try to re-discover a current one from OP.GG's JS bundle (crawl
 * chunks → `createServerReference(...)` ids → probe), rate-limited by a
 * cooldown. Discovery may not always recover (a new build can need params we
 * don't derive); when it can't, we fail-soft to `[]`. The `next-router-state-
 * tree` is route-structure based and treated as stable.
 *
 * Unofficial + best-effort: any failure (stale id, discovery miss, timeout,
 * unmappable region) returns `[]`. The add-player field still works via our
 * own index + the Riot exact-resolve path, and OP.GG data is never persisted
 * unverified — every pick is re-confirmed through Riot before storage. Seed id
 * captured 2026-06-19; backstop is re-capturing it from op.gg devtools.
 */

import { z } from "zod";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("opgg-search");

const OPGG_ORIGIN = "https://op.gg";
const OPGG_URL = `${OPGG_ORIGIN}/`;
/** Seed/fallback action id; replaced at runtime by discovery when it rotates. */
const OPGG_ACTION_ID = "402c9587dc35c9a189a48efae20bebb24826369a95";
const OPGG_ROUTER_STATE =
  "%5B%22%22%2C%7B%22children%22%3A%5B%5B%22locale%22%2C%22en%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22lol%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15";
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
  /** Raw OP.GG profile-icon URL (proxied before it reaches the browser). */
  avatar: string | null;
};

const OpggSummonerSchema = z.object({
  gameName: z.string().min(1),
  tagline: z.string().min(1),
  ranked: z.string().nullable().optional(),
  thumbnail: z.string().nullable().optional(),
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
 * Candidate Next.js server-action ids registered in a JS chunk, i.e. the
 * first string argument of `createServerReference("<id>", ...)`. Precise (only
 * actual action ids, not every long hex literal). Exported for testing.
 */
export function extractActionIdCandidates(js: string): string[] {
  const ids = new Set<string>();
  for (const match of js.matchAll(
    /createServerReference\)?\(\s*"([0-9a-f]{40,42})"/g,
  )) {
    const id = match[1];
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

let cachedActionId = OPGG_ACTION_ID;
let discoveryInFlight: Promise<string | null> | null = null;
let lastDiscoveryAt = 0;
/** Don't re-crawl OP.GG's bundle more than once per this window on failures. */
const DISCOVERY_COOLDOWN_MS = 10 * 60 * 1000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type SearchOutcome =
  | { kind: "ok"; summoners: OpggSummoner[] }
  | { kind: "stale" } // non-OK HTTP — the action id is likely stale
  | { kind: "error" }; // network / timeout

async function runSearch(
  actionId: string,
  opggRegion: string,
  query: string,
): Promise<SearchOutcome> {
  try {
    const response = await fetchWithTimeout(
      OPGG_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          Accept: "text/x-component",
          Origin: OPGG_ORIGIN,
          Referer: OPGG_URL,
          "User-Agent": USER_AGENT,
          "next-action": actionId,
          "next-router-state-tree": OPGG_ROUTER_STATE,
        },
        body: JSON.stringify([
          { region: opggRegion, value: query, locale: "en" },
        ]),
      },
      TIMEOUT_MS,
    );
    if (!response.ok) return { kind: "stale" };
    return { kind: "ok", summoners: extractSummoners(await response.text()) };
  } catch (error) {
    logger.warn("OP.GG search request failed", { error });
    return { kind: "error" };
  }
}

async function fetchText(url: string): Promise<string> {
  try {
    const response = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": USER_AGENT } },
      TIMEOUT_MS,
    );
    return response.ok ? await response.text() : "";
  } catch {
    return "";
  }
}

/**
 * Every JS chunk URL for the OP.GG LoL app — the initial ones in the homepage
 * HTML plus the lazy ones enumerated from the webpack runtime's chunk map (the
 * autocomplete action lives in a lazy chunk, so the HTML alone isn't enough).
 */
async function listChunkUrls(): Promise<string[]> {
  const homepage = await fetchText(OPGG_URL);
  const initial =
    homepage.match(
      /https:\/\/[a-z0-9.-]+\/[\w./-]*static\/chunks\/[\w./-]+\.js/g,
    ) ?? [];
  const first = initial[0];
  if (first === undefined) return [];
  const prefix = first.split("static/chunks/")[0] ?? "";
  const urls = new Set(initial);

  const webpackUrl = initial.find((url) => url.includes("/webpack-"));
  if (webpackUrl !== undefined && prefix.length > 0) {
    const webpack = await fetchText(webpackUrl);
    for (const file of webpack.match(/static\/chunks\/[\w./-]+\.js/g) ?? []) {
      urls.add(prefix + file);
    }
  }
  return [...urls];
}

/**
 * Re-discover the current autocomplete action id from OP.GG's live bundle:
 * crawl all chunks, collect the `createServerReference("<id>", …)` ids, and
 * probe each against a known query — the one returning `{summoners}` is the
 * autocomplete action. Fail-soft (returns null). In-flight-guarded so
 * concurrent stale hits discover once.
 */
async function discoverActionId(): Promise<string | null> {
  discoveryInFlight ??= (async () => {
    try {
      const chunkUrls = await listChunkUrls();
      const chunks = await Promise.all(chunkUrls.map((url) => fetchText(url)));
      const candidates = new Set<string>();
      for (const js of chunks) {
        for (const id of extractActionIdCandidates(js)) candidates.add(id);
      }

      for (const id of candidates) {
        const probe = await runSearch(id, "kr", "faker");
        if (probe.kind === "ok" && probe.summoners.length > 0) {
          logger.info("Discovered fresh OP.GG action id", { id });
          return id;
        }
      }
      logger.warn("OP.GG action id discovery found no working candidate", {
        candidates: candidates.size,
      });
      return null;
    } catch (error) {
      logger.warn("OP.GG action id discovery failed", { error });
      return null;
    } finally {
      discoveryInFlight = null;
    }
  })();
  return discoveryInFlight;
}

function toSuggestions(
  summoners: OpggSummoner[],
  region: string,
): OpggSuggestion[] {
  return summoners.slice(0, MAX_RESULTS).map((summoner) => ({
    gameName: summoner.gameName,
    tagLine: summoner.tagline,
    region,
    tier: summoner.ranked ?? null,
    avatar: summoner.thumbnail ?? null,
  }));
}

/**
 * Search OP.GG for summoners whose name starts with `query` in `region` (our
 * RegionSchema value). Fail-soft: returns `[]` on any error/timeout/parse
 * failure / unmappable region. Self-heals a rotated action id.
 */
export async function opggSearch(
  query: string,
  region: string,
): Promise<OpggSuggestion[]> {
  const trimmed = query.trim();
  const opggRegion = REGION_TO_OPGG[region];
  if (trimmed.length < 2 || opggRegion === undefined) return [];

  let outcome = await runSearch(cachedActionId, opggRegion, trimmed);
  if (
    outcome.kind === "stale" &&
    Date.now() - lastDiscoveryAt > DISCOVERY_COOLDOWN_MS
  ) {
    lastDiscoveryAt = Date.now();
    const fresh = await discoverActionId();
    if (fresh !== null && fresh !== cachedActionId) {
      cachedActionId = fresh;
      outcome = await runSearch(cachedActionId, opggRegion, trimmed);
    }
  }
  return outcome.kind === "ok" ? toSuggestions(outcome.summoners, region) : [];
}
