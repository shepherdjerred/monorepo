import * as R from "remeda";
import { fetchAllCached } from "./cache.ts";
import { fetchAll as fetchAllUncached } from "./fetch.ts";
import {
  type Configuration,
  type Result,
  CachedConfigurationSchema,
} from "./types.ts";

export async function run(config: Configuration): Promise<Result> {
  const { success, data } = CachedConfigurationSchema.safeParse(config);

  let fetched: Result;
  if (success) {
    console.warn(`Using cache at ${data.cache.cache_file}.`);
    fetched = await fetchAllCached(data);
  } else {
    console.warn("Cache disabled.");
    fetched = await fetchAllUncached(config);
  }

  let results = R.pipe(
    fetched,
    R.sortBy((entry) => entry.date.getTime()),
    R.reverse(),
    R.filter((entry) => {
      const filterFn = entry.source.filter;
      if (
        filterFn === undefined ||
        entry.preview === undefined ||
        entry.preview === ""
      ) {
        return true;
      }
      return filterFn(entry.preview);
    }),
  );

  // shuffle if wanted
  if (config.shuffle === true) {
    results = R.shuffle(results);
  }

  // take n
  results = R.take(results, config.number);

  return results;
}
