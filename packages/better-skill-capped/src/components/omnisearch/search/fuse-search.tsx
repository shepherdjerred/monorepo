import * as Fuse from "fuse.js";
import { useMemo } from "react";

export type FuseSearchResult<T> = {
  item: T;
  matchedStrings: string[];
};

function createIndexedFuseInstance<T>(
  items: T[],
  options: Fuse.IFuseOptions<T>,
): Fuse.default<T> {
  const index = Fuse.default.createIndex(options.keys ?? [], items);
  return new Fuse.default<T>(items, options, index);
}

function toMatchedStrings(
  matches: readonly Fuse.FuseResultMatch[] | undefined,
): string[] {
  return (
    (matches ?? [])
      .flatMap((match) => {
        const { indices, value } = match;
        return indices.map((index) =>
          value === undefined ? "" : value.slice(index[0], index[1] + 1),
        );
      })
      // Filter out short matches to avoid highlighting scattered letters
      .filter((str) => str.length >= 4)
      .filter((value, index, self) => self.indexOf(value) === index)
  );
}

/**
 * Fuse search as a hook: the index rebuilds only when `items` or `options`
 * change identity, and the query runs only when the query or index changes.
 * Callers must pass referentially stable `options` (module-level constant).
 */
export function useFuseSearch<T>(
  items: T[],
  query: string,
  options: Fuse.IFuseOptions<T>,
): FuseSearchResult<T>[] {
  const fuse = useMemo(
    () => createIndexedFuseInstance(items, options),
    [items, options],
  );

  return useMemo(() => {
    if (query === "") {
      return items.map((item) => ({ item, matchedStrings: [] }));
    }
    return fuse.search(query).map((result) => ({
      item: result.item,
      matchedStrings: toMatchedStrings(result.matches),
    }));
  }, [fuse, items, query]);
}
