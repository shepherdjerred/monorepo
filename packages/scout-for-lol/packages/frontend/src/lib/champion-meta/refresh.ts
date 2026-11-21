import {
  ChampionResponseSchema,
  CHAMPION_META_SNAPSHOT_VERSION,
  EMPTY_CHAMPION_META_SNAPSHOT,
  MetaManifestResponseSchema,
  championSlug,
  type ChampionEntry,
  type ChampionMetaSnapshot,
} from "./snapshot.ts";

/**
 * Build the committed snapshot from a deployed meta API. The weekly Temporal
 * workflow runs this through `scripts/refresh-champion-meta.ts` in a scratch
 * clone and opens a PR when the result differs.
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

export async function buildChampionMetaSnapshot(
  options: RefreshOptions,
): Promise<ChampionMetaSnapshot> {
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
  if (manifestResult.status === "missing") return EMPTY_CHAMPION_META_SNAPSHOT;
  const manifest = MetaManifestResponseSchema.parse(manifestResult.body);
  const { defaults } = manifest;
  if (defaults === null || manifest.champions.length === 0) {
    return EMPTY_CHAMPION_META_SNAPSHOT;
  }

  // One consistent slice for the whole snapshot: the manifest's default
  // patch, queue and bracket, not whatever each champion happens to default to.
  const query = new URLSearchParams({
    patch: defaults.patch,
    queue: defaults.queueId.toString(),
    bracket: defaults.bracket,
  }).toString();

  const champions: ChampionEntry[] = [];
  for (const listed of manifest.champions.toSorted((a, b) => a.id - b.id)) {
    const result = await getJson(
      `${base}/champions/${listed.id.toString()}?${query}`,
      resolved,
      ["slice_not_found", "unknown_champion"],
    );
    // A champion with no slice in this context failed the API's sample floor.
    if (result.status === "missing") continue;
    const parsed = ChampionResponseSchema.parse(result.body);
    // A lake build published mid-refresh would mix statistics from two builds
    // under one build's attribution. Fail so the workflow retries.
    if (parsed.buildId !== manifest.buildId) {
      throw new Error(
        `Meta build changed during refresh: manifest ${manifest.buildId}, champion ${listed.id.toString()} ${parsed.buildId}`,
      );
    }
    if (parsed.slices.length === 0) continue;
    champions.push({
      id: parsed.championId,
      name: parsed.championName,
      slug: championSlug(parsed.championName),
      slices: parsed.slices.toSorted((a, b) =>
        a.context.role.localeCompare(b.context.role),
      ),
    });
  }
  champions.sort((a, b) => a.slug.localeCompare(b.slug));

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
