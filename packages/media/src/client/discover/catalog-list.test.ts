import { expect, test } from "vitest";
import type { CatalogSearch } from "#shared/api.ts";
import { readEveryPage } from "#client/ui/use-cursor-list.ts";
import { accessIsStale, catalogPage } from "./catalog-list.ts";

const title: CatalogSearch["results"][number] = {
  externalId: 603,
  kind: "movie",
  title: "The Matrix",
  overview: "",
  date: "1999-03-31",
  posterPath: null,
  backdropPath: null,
  originalLanguage: "en",
  library: null,
};

function answer(overrides: Partial<CatalogSearch> = {}): CatalogSearch {
  return {
    page: 1,
    totalPages: 1,
    libraryAccess: "current",
    results: [title],
    ...overrides,
  };
}

test("a page follows the catalog's page numbers to its last page", () => {
  expect(catalogPage(answer({ page: 1, totalPages: 3 })).nextCursor).toBe("2");
  expect(catalogPage(answer({ page: 3, totalPages: 3 })).nextCursor).toBeNull();
  expect(catalogPage(answer({ page: 1, totalPages: 1 })).nextCursor).toBeNull();
});

test("each title carries the access of the page it came on", () => {
  expect(catalogPage(answer({ libraryAccess: "stale" })).items).toEqual([
    { item: title, access: "stale" },
  ]);
  expect(catalogPage(answer()).items).toEqual([
    { item: title, access: "current" },
  ]);
});

test("a page with no titles still says its access could not be confirmed", () => {
  const empty = catalogPage(answer({ libraryAccess: "stale", results: [] }));
  expect(empty.items).toEqual([]);
  expect(accessIsStale([empty])).toBe(true);
});

test("an empty page with confirmed access is only an empty result", () => {
  expect(accessIsStale([catalogPage(answer({ results: [] }))])).toBe(false);
  expect(accessIsStale([])).toBe(false);
});

test("one page that could not be checked is enough, wherever it is", () => {
  const current = catalogPage(answer({ page: 1, totalPages: 2 }));
  const stale = catalogPage(
    answer({ page: 2, totalPages: 2, libraryAccess: "stale", results: [] }),
  );
  expect(accessIsStale([current, stale])).toBe(true);
  expect(accessIsStale([current, current])).toBe(false);
});

test("a list read whole keeps what its last page says beyond its rows", async () => {
  const pages = [
    catalogPage(answer({ page: 1, totalPages: 2 })),
    catalogPage(
      answer({ page: 2, totalPages: 2, libraryAccess: "stale", results: [] }),
    ),
  ];
  const whole = await readEveryPage((cursor) => {
    const page = pages[cursor === null ? 0 : Number(cursor) - 1];
    if (page === undefined) throw new Error(`No page at ${String(cursor)}`);
    return Promise.resolve(page);
  });
  expect(whole.items).toEqual([{ item: title, access: "current" }]);
  expect(whole.nextCursor).toBeNull();
  expect(whole.access).toBe("stale");
});
