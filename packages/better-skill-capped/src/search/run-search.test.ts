import { beforeAll, describe, expect, test } from "bun:test";
import { buildChampionAliases, normalizeName } from "./normalize.ts";
import { contentToSearchDocs } from "./search-doc.ts";
import { createSearchIndex, type SearchIndex } from "./index-builder.ts";
import {
  runSearch,
  type SearchRunParams,
  type UserContentState,
} from "./run-search.ts";
import { getHighlightTerms } from "./highlight.ts";
import { searchFixtureContent } from "./fixtures/search-fixture.ts";

const NO_STATE: UserContentState = {
  watchedUuids: new Set(),
  bookmarkedUuids: new Set(),
};

function params(overrides: Partial<SearchRunParams> = {}): SearchRunParams {
  return {
    q: "",
    kind: [],
    role: [],
    champion: [],
    staff: [],
    tag: [],
    carry: [],
    ctype: [],
    watched: "any",
    bookmarked: "any",
    sort: "relevance",
    page: 1,
    ...overrides,
  };
}

let index: SearchIndex;

beforeAll(async () => {
  index = await createSearchIndex(contentToSearchDocs(searchFixtureContent()));
});

describe("normalizeName", () => {
  test("strips apostrophes, punctuation, and case", () => {
    expect(normalizeName("Kai'Sa")).toBe("kaisa");
    expect(normalizeName("K'Sante")).toBe("ksante");
    expect(normalizeName("Cho'Gath")).toBe("chogath");
    expect(normalizeName("Bel’Veth")).toBe("belveth");
    expect(normalizeName("Dr. Mundo")).toBe("drmundo");
    expect(normalizeName("Nunu & Willump")).toBe("nunuwillump");
  });
});

describe("runSearch", () => {
  test("browse mode returns everything, newest first", async () => {
    const result = await runSearch(index, params(), NO_STATE);
    expect(result.total).toBe(11);
    expect(result.docs[0]?.uuid).toBe("crs-wave");
    const dates = result.docs.map((doc) => doc.releaseDate);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  test("finds Kai'Sa by normalized, apostrophed, and split spellings", async () => {
    for (const query of ["kaisa", "kai'sa", "kai sa"]) {
      const result = await runSearch(index, params({ q: query }), NO_STATE);
      expect(result.docs.map((doc) => doc.uuid)).toContain("c-kaisa");
    }
  });

  test("finds K'Sante by normalized spelling", async () => {
    const result = await runSearch(index, params({ q: "ksante" }), NO_STATE);
    expect(result.docs.map((doc) => doc.uuid)).toContain("c-ksante");
  });

  test("ranks title matches above child-title and description matches", async () => {
    const result = await runSearch(
      index,
      params({ q: "wave control" }),
      NO_STATE,
    );
    const uuids = result.docs.map((doc) => doc.uuid);
    expect(uuids).toContain("crs-wave");
    expect(uuids).toContain("crs-macro");
    expect(uuids).toContain("v-laning");
    expect(uuids.indexOf("crs-wave")).toBeLessThan(uuids.indexOf("crs-macro"));
    expect(uuids.indexOf("crs-macro")).toBeLessThan(uuids.indexOf("v-laning"));
  });

  test("typo-tolerant queries still return results", async () => {
    const result = await runSearch(
      index,
      params({ q: "wave contrl" }),
      NO_STATE,
    );
    expect(result.total).toBeGreaterThan(0);
  });

  test("kind and role where-clauses restrict results", async () => {
    const commentaries = await runSearch(
      index,
      params({ kind: ["commentary"] }),
      NO_STATE,
    );
    expect(commentaries.total).toBe(4);
    expect(commentaries.docs.every((doc) => doc.kind === "commentary")).toBe(
      true,
    );

    const jungle = await runSearch(
      index,
      params({ role: ["jungle"] }),
      NO_STATE,
    );
    expect(jungle.docs.map((doc) => doc.uuid)).toEqual(["c-graves"]);
  });

  test("facet counts reflect the corpus", async () => {
    const result = await runSearch(index, params(), NO_STATE);
    expect(result.facets.kind).toEqual({
      course: 3,
      video: 4,
      commentary: 4,
    });
    expect(result.facets.staff["Sjorry"]).toBe(2);
    expect(result.facets.staff["Hector"]).toBe(1);
    expect(result.facets.champion["Kai'Sa"]).toBe(1);
  });

  test("watched filter excludes docs and corrects facet counts", async () => {
    const state: UserContentState = {
      watchedUuids: new Set(["c-kaisa", "v-laning"]),
      bookmarkedUuids: new Set(),
    };
    const result = await runSearch(
      index,
      params({ watched: "unwatched" }),
      state,
    );
    const uuids = result.docs.map((doc) => doc.uuid);
    expect(uuids).not.toContain("c-kaisa");
    expect(uuids).not.toContain("v-laning");
    expect(result.total).toBe(9);
    // Corrected counts: the watched Kai'Sa commentary no longer counts.
    expect(result.facets.kind["commentary"]).toBe(3);
    expect(result.facets.kind["video"]).toBe(3);
    expect(result.facets.staff["Sjorry"]).toBe(1);
    expect(result.facets.champion["Kai'Sa"]).toBe(0);
  });

  test("tag filter narrows to tagged courses and facet counts include tags", async () => {
    const all = await runSearch(index, params(), NO_STATE);
    expect(all.facets.tags["Support - Wave Control"]).toBe(1);

    const tagged = await runSearch(
      index,
      params({ tag: ["Support - Wave Control"] }),
      NO_STATE,
    );
    expect(tagged.docs.map((doc) => doc.uuid)).toEqual(["crs-wave"]);
  });

  test("recommended flag flows into search docs", async () => {
    const result = await runSearch(index, params(), NO_STATE);
    const wave = result.docs.find((doc) => doc.uuid === "crs-wave");
    expect(wave?.recommended).toBe(true);
  });

  test("bookmarked filter narrows to bookmarked docs", async () => {
    const state: UserContentState = {
      watchedUuids: new Set(),
      bookmarkedUuids: new Set(["crs-wave"]),
    };
    const result = await runSearch(
      index,
      params({ bookmarked: "bookmarked" }),
      state,
    );
    expect(result.docs.map((doc) => doc.uuid)).toEqual(["crs-wave"]);
  });

  test("sort options reorder results", async () => {
    const shortest = await runSearch(
      index,
      params({ sort: "shortest" }),
      NO_STATE,
    );
    const durations = shortest.docs.map((doc) => doc.durationInSeconds);
    expect(durations).toEqual([...durations].sort((a, b) => a - b));

    const oldest = await runSearch(index, params({ sort: "oldest" }), NO_STATE);
    const dates = oldest.docs.map((doc) => doc.releaseDate);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  test("pagination slices and reports page count", async () => {
    const page1 = await runSearch(index, params(), NO_STATE);
    expect(page1.pageCount).toBe(1);
    expect(page1.docs).toHaveLength(11);

    // Out-of-range pages clamp instead of rendering an empty slice while
    // results exist (stale or hand-edited URLs).
    const page2 = await runSearch(index, params({ page: 2 }), NO_STATE);
    expect(page2.page).toBe(1);
    expect(page2.docs).toHaveLength(11);
    expect(page2.total).toBe(11);

    const pageZeroIsh = await runSearch(index, params({ page: 99 }), NO_STATE);
    expect(pageZeroIsh.page).toBe(1);
    expect(pageZeroIsh.docs).toHaveLength(11);
  });
});

describe("getHighlightTerms", () => {
  const aliases = buildChampionAliases(["Kai'Sa", "K'Sante", "Lux"]);

  test("returns query tokens plus matching champion display names", () => {
    expect(getHighlightTerms("kaisa guide", aliases).toSorted()).toEqual([
      "Kai'Sa",
      "guide",
      "kaisa",
    ]);
  });

  test("drops single-character tokens and operator prefixes", () => {
    expect(getHighlightTerms("a =lux", aliases).toSorted()).toEqual([
      "Lux",
      "lux",
    ]);
  });
});
