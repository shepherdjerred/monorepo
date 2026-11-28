import {
  ChampionResponseSchema,
  CHAMPION_META_SNAPSHOT_VERSION,
  EMPTY_CHAMPION_META_SNAPSHOT,
  championSlug,
  type ChampionEntry,
  type ChampionMetaSnapshot,
  type ChampionResponse,
} from "./snapshot.ts";
import { buildSnapshotV2, type MetaSource } from "./snapshot-v2.ts";
import {
  EMPTY_SNAPSHOT_V2,
  MatchupsResponseSchema,
  type MatchupsResponse,
  type SnapshotV2,
} from "./snapshot-v2-schema.ts";
import { MetaManifestSchema } from "@scout-for-lol/data/meta/meta-serving.ts";

/**
 * Build the committed snapshot from a deployed meta API. The weekly Temporal
 * workflow runs this through `scripts/refresh-champion-meta.ts` in a scratch
 * clone and opens a PR when the result differs.
 *
 * It writes both snapshots from the one set of API answers: the single-file
 * snapshot `meta/v1` consumers read, and the split snapshot v2
 * (`snapshot-v2-schema.ts`) the public pages move to.
 *
 * Nothing published yet is an expected state, not an error: the API answers
 * 503 `meta_unavailable` until the crawl has produced a build, and the
 * snapshot is then the empty one. Every other failure throws so a broken
 * contract never turns into an empty or partial snapshot.
 */

export type FetchLike = (url: string) => Promise<Response>;

export type RefreshOptions = {
  /** Origin of the meta API, e.g. `https://scout-for-lol.com`. */
  origin: string;
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
};

const MAX_RATE_LIMIT_RETRIES = 5;

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return undefined;
    const error: unknown = Reflect.get(body, "error");
    if (typeof error !== "object" || error === null) return undefined;
    const code: unknown = Reflect.get(error, "code");
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

type ApiResult = { status: "ok"; body: unknown } | { status: "missing" };

/** 429s wait out `Retry-After`; `missing` is the API's typed 503/404 answer. */
async function getJson(
  url: string,
  options: Required<Pick<RefreshOptions, "fetch" | "sleep">>,
  missingCodes: readonly string[],
): Promise<ApiResult> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await options.fetch(url);
    if (response.ok) return { status: "ok", body: await response.json() };
    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const seconds = Number(response.headers.get("Retry-After") ?? "60");
      await options.sleep((Number.isFinite(seconds) ? seconds : 60) * 1000);
      continue;
    }
    const code = await errorCode(response);
    if (code !== undefined && missingCodes.includes(code)) {
      return { status: "missing" };
    }
    throw new Error(
      `Meta API ${url} answered ${response.status.toString()}${code === undefined ? "" : ` (${code})`}`,
    );
  }
}

/**
 * One consistent slice for the whole snapshot: the manifest's default patch,
 * queue and bracket, not whatever each champion happens to default to. A lake
 * build published mid-refresh would mix statistics from two builds under one
 * build's attribution, so any answer from another build fails the refresh and
 * the workflow retries.
 */
async function fetchMetaSource(
  options: RefreshOptions,
  include: { matchups: boolean },
): Promise<MetaSource | undefined> {
  const resolved = {
    fetch: options.fetch ?? ((url: string) => fetch(url)),
    sleep:
      options.sleep ??
      (async (milliseconds: number) => {
        await Bun.sleep(milliseconds);
      }),
  };
  const base = `${options.origin.replace(/\/+$/u, "")}/api/meta/v1`;

  const manifestResult = await getJson(`${base}/manifest`, resolved, [
    "meta_unavailable",
  ]);
  if (manifestResult.status === "missing") return undefined;
  const manifest = MetaManifestSchema.parse(manifestResult.body);
  const { defaults } = manifest;
  if (defaults === null || manifest.champions.length === 0) return undefined;

  const query = new URLSearchParams({
    patch: defaults.patch,
    queue: defaults.queueId.toString(),
    bracket: defaults.bracket,
  }).toString();
  const sameBuild = (buildId: string, what: string) => {
    if (buildId !== manifest.buildId) {
      throw new Error(
        `Meta build changed during refresh: manifest ${manifest.buildId}, ${what} ${buildId}`,
      );
    }
  };

  const champions: ChampionResponse[] = [];
  const matchups = new Map<number, MatchupsResponse>();
  for (const listed of manifest.champions.toSorted((a, b) => a.id - b.id)) {
    const id = listed.id.toString();
    const result = await getJson(`${base}/champions/${id}?${query}`, resolved, [
      "slice_not_found",
      "unknown_champion",
    ]);
    // A champion with no slice in this context failed the API's sample floor.
    if (result.status === "missing") continue;
    const parsed = ChampionResponseSchema.parse(result.body);
    sameBuild(parsed.buildId, `champion ${id}`);
    if (parsed.slices.length === 0) continue;
    champions.push(parsed);
    if (!include.matchups) continue;
    const listedMatchups = await getJson(
      `${base}/matchups/${id}?${query}`,
      resolved,
      ["matchup_not_found"],
    );
    // No opponent met the matchup floor: the champion has a page, no matchups.
    if (listedMatchups.status === "missing") continue;
    const response = MatchupsResponseSchema.parse(listedMatchups.body);
    sameBuild(response.buildId, `matchups ${id}`);
    matchups.set(response.championId, response);
  }
  return { manifest, champions, matchups };
}

function singleFileSnapshot(
  source: MetaSource | undefined,
): ChampionMetaSnapshot {
  if (source === undefined) return EMPTY_CHAMPION_META_SNAPSHOT;
  const { manifest } = source;
  const champions: ChampionEntry[] = source.champions
    .map((parsed) => ({
      id: parsed.championId,
      name: parsed.championName,
      slug: championSlug(parsed.championName),
      slices: parsed.slices.toSorted((a, b) =>
        a.context.role.localeCompare(b.context.role),
      ),
    }))
    .toSorted((a, b) => a.slug.localeCompare(b.slug));
  return {
    schemaVersion: CHAMPION_META_SNAPSHOT_VERSION,
    source: {
      buildId: manifest.buildId,
      generatedAt: manifest.generatedAt,
      firstDay: manifest.source.firstDay,
      lastDay: manifest.source.lastDay,
      minSliceGames: manifest.thresholds.minSliceGames,
    },
    caveats: manifest.caveats,
    champions,
  };
}

export async function buildChampionMetaSnapshot(
  options: RefreshOptions,
): Promise<ChampionMetaSnapshot> {
  return singleFileSnapshot(
    await fetchMetaSource(options, { matchups: false }),
  );
}

/** Both snapshots from one set of API answers. */
export async function buildChampionMetaSnapshots(
  options: RefreshOptions,
): Promise<{ single: ChampionMetaSnapshot; split: SnapshotV2 }> {
  const source = await fetchMetaSource(options, { matchups: true });
  return {
    single: singleFileSnapshot(source),
    split: source === undefined ? EMPTY_SNAPSHOT_V2 : buildSnapshotV2(source),
  };
}
