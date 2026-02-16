import * as R from "remeda";
import {
  type Cache,
  type Result,
  type ResultEntry,
  type CacheEntry,
  type Source,
  type CachedConfiguration,
  CacheSchema,
  type CacheConfiguration,
} from "./types.js";
import { fetch } from "./fetch.js";
import { asyncMapFilterUndefined } from "./util.js";
import * as fs from "fs/promises";

async function loadCache({ cache_file }: CacheConfiguration): Promise<Cache> {
  try {
    await fs.access(cache_file);
    const cacheFile = await fs.readFile(cache_file);
    return CacheSchema.parse(JSON.parse(cacheFile.toString()));
  } catch (_e) {
    return {};
  }
}

async function saveCache({ cache_file }: CacheConfiguration, cache: Cache) {
  const dir = cache_file.split("/").slice(0, -1).join("/");
  if (dir !== "") {
    await fs.mkdir(cache_file.split("/").slice(0, -1).join("/"), { recursive: true });
  }
  await fs.writeFile(cache_file, JSON.stringify(cache));
}

function toCacheEntry(result: ResultEntry, now: Date): [string, CacheEntry] {
  return [result.source.url, { timestamp: now, data: result }];
}

function toCache(results: ResultEntry[], now: Date): Cache {
  return R.pipe(
    results,
    R.map((result) => toCacheEntry(result, now)),
    R.fromEntries(),
  );
}

function updateCache(results: ResultEntry[], config: CachedConfiguration): Promise<void> {
  const now = new Date();
  const updatedCache = toCache(results, now);
  return saveCache(config.cache, updatedCache);
}

export async function fetchAllCached(config: CachedConfiguration): Promise<Result> {
  const cache = await loadCache(config.cache);

  const results = await asyncMapFilterUndefined(config.sources, (source) => fetchWithCache(source, cache, config));

  await updateCache(results, config);

  return results;
}

export async function fetchWithCache(
  source: Source,
  cache: Cache,
  config: CachedConfiguration,
): Promise<ResultEntry | undefined> {
  const cacheEntry = cache[source.url];
  if (cacheEntry) {
    const now = new Date();
    if (now.getTime() - cacheEntry.timestamp.getTime() < config.cache.cache_duration_minutes * 60 * 1000) {
      console.log(`Cache entry found for ${source.url}.`);
      return Promise.resolve(cacheEntry.data);
    } else {
      console.log(`Cache entry for ${source.url} is too old.`);
    }
  } else {
    console.log(`No cache entry for ${source.url}.`);
  }

  console.log(`Fetching ${source.url}`);
  return fetch(source, config.truncate);
}
