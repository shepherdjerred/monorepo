import { expect, test } from "vitest";
import { CatalogFeedSchema } from "#shared/catalog/contract.ts";
import {
  catalogReadPath,
  DISCOVER_PATH,
  FEED_ORDER,
  feedAddress,
  feedFromSlug,
  QUERY_LIMIT,
  readSearch,
  searchAddress,
} from "./view.ts";

function searchOf(address: string): string {
  return readSearch(new URL(address, "http://media.invalid").searchParams);
}

test("an address with no search, or only spaces, asks for the browse rows", () => {
  expect(readSearch(new URLSearchParams())).toBe("");
  expect(readSearch(new URLSearchParams("q="))).toBe("");
  expect(readSearch(new URLSearchParams("q=%20%20"))).toBe("");
  expect(searchAddress("")).toBe(DISCOVER_PATH);
  expect(searchAddress("   ")).toBe(DISCOVER_PATH);
});

test("a search is trimmed, and survives the trip through its address", () => {
  expect(searchAddress("  the bear ")).toBe("/discover?q=the+bear");
  for (const query of ["the bear", "Shōgun", "50% & rising?", "#1 = a+b"]) {
    expect(searchOf(searchAddress(query)), query).toBe(query);
  }
});

test("a search longer than the catalog accepts is cut to what it accepts", () => {
  const long = `${"a".repeat(QUERY_LIMIT - 1)} bcd`;
  const read = readSearch(new URLSearchParams({ q: long }));
  // The cut lands on the space, which a search does not end with.
  expect(read).toBe("a".repeat(QUERY_LIMIT - 1));
  expect(searchOf(searchAddress(long))).toBe(read);
});

test("every feed has a row and an address of its own", () => {
  expect([...FEED_ORDER].sort()).toEqual([...CatalogFeedSchema.options].sort());
  const addresses = FEED_ORDER.map((feed) => feedAddress(feed));
  expect(new Set(addresses).size).toBe(FEED_ORDER.length);
  for (const feed of FEED_ORDER) {
    const address = feedAddress(feed);
    expect(address).toMatch(/^\/discover\/[a-z-]+$/u);
    expect(feedFromSlug(address.slice("/discover/".length))).toBe(feed);
  }
  expect(feedAddress("popular_movies")).toBe("/discover/popular-films");
});

test("an address that names no feed is not read as one", () => {
  expect(feedFromSlug(undefined)).toBeNull();
  expect(feedFromSlug("")).toBeNull();
  expect(feedFromSlug("popular_movies")).toBeNull();
  expect(feedFromSlug("no-such-list")).toBeNull();
});

test("a list reads the catalog a numbered page at a time", () => {
  expect(catalogReadPath({ kind: "search", query: "the bear" }, 1)).toBe(
    "/catalog/search?q=the+bear&page=1",
  );
  expect(catalogReadPath({ kind: "feed", feed: "on_the_air" }, 3)).toBe(
    "/catalog/discover?feed=on_the_air&page=3",
  );
});
