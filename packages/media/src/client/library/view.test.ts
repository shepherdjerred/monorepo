import { expect, test } from "vitest";
import { LibraryQuerySchema } from "#shared/household/library.ts";
import {
  DEFAULT_VIEW,
  isFiltered,
  libraryReadPath,
  libraryViewSearch,
  readLibraryView,
} from "./view.ts";

function view(search: string) {
  return readLibraryView(new URLSearchParams(search));
}

test("a bare address is the default view and names nothing", () => {
  expect(view("")).toEqual(DEFAULT_VIEW);
  expect(libraryViewSearch(DEFAULT_VIEW)).toBe("");
});

test("a view survives being written to an address and read back", () => {
  const chosen = {
    query: "dune part",
    kind: "movie",
    keeping: "temporary",
    status: "unavailable",
    sort: "added",
    layout: "list",
  } as const;
  const search = libraryViewSearch(chosen);
  expect(search).toBe(
    "?q=dune+part&kind=movie&keeping=temporary&status=unavailable&sort=added&view=list",
  );
  expect(view(search)).toEqual(chosen);
});

test("a value the page does not know reads as that setting's default", () => {
  expect(view("kind=podcast&sort=rating&view=table&keeping=&status=x")).toEqual(
    DEFAULT_VIEW,
  );
});

test("only search and filters count as narrowing the library", () => {
  expect(isFiltered(view("sort=added&view=list"))).toBe(false);
  expect(isFiltered(view("q=%20%20"))).toBe(false);
  for (const search of [
    "q=a",
    "kind=series",
    "keeping=keep",
    "status=available",
  ])
    expect(isFiltered(view(search)), search).toBe(true);
});

test("every view asks the API a question its query schema accepts", () => {
  const read = libraryReadPath(
    view("q=the&kind=series&keeping=unclassified&status=available&sort=added"),
    JSON.stringify({ addedAt: "2026-01-01T00:00:00.000Z", id: "abc" }),
  );
  const query = LibraryQuerySchema.parse(
    Object.fromEntries(new URL(read, "http://media.invalid").searchParams),
  );
  expect(query).toMatchObject({
    query: "the",
    kind: "series",
    policy: "unclassified",
    availability: "available",
    sort: "added",
    limit: 48,
  });
  expect(libraryReadPath(DEFAULT_VIEW, null)).not.toContain("cursor");
});
