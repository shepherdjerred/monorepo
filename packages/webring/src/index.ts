import * as R from "remeda";
import { fetchAllCached as fetchAllCached } from "./cache.js";
import { fetchAll as fetchAllUncached } from "./fetch.js";
import { type Configuration, type Result, CachedConfigurationSchema } from "./types.js";

export async function run(config: Configuration): Promise<Result> {
  const { success, data } = CachedConfigurationSchema.safeParse(config);

  let result: Result;
  if (success) {
    console.log(`Using cache at ${data.cache.cache_file}.`);
    result = await fetchAllCached(data);
  } else {
    console.log("Cache disabled.");
    result = await fetchAllUncached(config);
  }

  let results = R.pipe(
    result,
    R.sortBy((result) => result.date.getTime()),
    R.reverse(),
    R.filter((result) => {
      if (result.source.filter && result.preview) {
        return result.source.filter(result.preview);
      } else {
        return true;
      }
    }),
  );

  // shuffle if wanted
  if (config.shuffle) {
    results = R.shuffle(results);
  }

  // take n
  results = R.take(results, config.number);

  return results;
}

export * from "./types.js";
