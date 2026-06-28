import { describe, expect, test } from "bun:test";
import { parsePatchesFromHtml, selectPatchByMinor } from "./riot-patch.ts";

// Mirrors the real Riot patch-notes `__NEXT_DATA__` shape: articles carry a
// `title`, an html `description.body` tagline, and a `url`/`action` weblink.
// Includes a non-patch article and an `action`-shaped link to exercise both
// the title filter and the url/action fallback.
function fixtureHtml(): string {
  const data = {
    props: {
      pageProps: {
        page: {
          blades: [
            {
              items: [
                {
                  title: "League of Legends Patch 26.13 Notes",
                  description: {
                    type: "html",
                    body: "Absolutely no demons allowed. - Locke",
                  },
                  url: {
                    type: "weblink",
                    payload: {
                      url: "/en-us/news/game-updates/league-of-legends-patch-26-13-notes",
                    },
                  },
                },
                {
                  title: "League of Legends Patch 26.12 Notes",
                  description: {
                    type: "html",
                    body: "A spicy start to Season 2 Act 2",
                  },
                  action: {
                    type: "weblink",
                    payload: {
                      url: "/en-us/news/game-updates/league-of-legends-patch-26-12-notes",
                    },
                  },
                },
                {
                  title: "Some Other News Article",
                  description: { type: "html", body: "Not a patch" },
                  url: {
                    type: "weblink",
                    payload: { url: "/en-us/news/whatever" },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  };
  return `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    data,
  )}</script></body></html>`;
}

describe("parsePatchesFromHtml", () => {
  test("extracts patch articles, newest first, skipping non-patch news", () => {
    const patches = parsePatchesFromHtml(fixtureHtml());
    expect(patches.map((p) => p.patch)).toEqual(["26.13", "26.12"]);
  });

  test("parses the real patch number, tagline, and an absolute URL", () => {
    const [latest] = parsePatchesFromHtml(fixtureHtml());
    expect(latest?.patch).toBe("26.13");
    expect(latest?.major).toBe(26);
    expect(latest?.minor).toBe(13);
    expect(latest?.tagline).toBe("Absolutely no demons allowed. - Locke");
    expect(latest?.url).toBe(
      "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-13-notes",
    );
  });

  test("falls back to the `action` weblink when `url` is absent", () => {
    const patches = parsePatchesFromHtml(fixtureHtml());
    const p2612 = patches.find((p) => p.patch === "26.12");
    expect(p2612?.url).toBe(
      "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-12-notes",
    );
  });

  test("throws when __NEXT_DATA__ is missing", () => {
    expect(() =>
      parsePatchesFromHtml("<html><body>nope</body></html>"),
    ).toThrow(/__NEXT_DATA__/);
  });

  test("throws on invalid __NEXT_DATA__ JSON", () => {
    expect(() =>
      parsePatchesFromHtml(
        '<script id="__NEXT_DATA__" type="application/json">{ not json }</script>',
      ),
    ).toThrow(/JSON/);
  });

  test("throws when no patch-notes articles are present", () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">{"items":[{"title":"Dev Blog"}]}</script>';
    expect(() => parsePatchesFromHtml(html)).toThrow(/no 'Patch/);
  });
});

describe("selectPatchByMinor", () => {
  test("matches by minor (week), independent of the major", () => {
    const patches = parsePatchesFromHtml(fixtureHtml());
    expect(selectPatchByMinor(patches, 13)?.patch).toBe("26.13");
    expect(selectPatchByMinor(patches, 12)?.patch).toBe("26.12");
  });

  test("returns undefined when the matching minor is not posted yet", () => {
    const patches = parsePatchesFromHtml(fixtureHtml());
    expect(selectPatchByMinor(patches, 14)).toBeUndefined();
  });
});
