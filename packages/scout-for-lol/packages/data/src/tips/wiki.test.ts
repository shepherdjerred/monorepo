import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fakeWiki } from "#src/tips/fake-wiki.fixture.ts";
import {
  WIKI_HOST,
  WIKI_USER_AGENT,
  type WikiFetch,
  assertWikiUrl,
  createWikiClient,
  lookupWikiPage,
  prefetchChampionWiki,
  wikiHtmlToText,
} from "#src/tips/wiki.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(`${tmpdir()}/scout-tips-wiki-`);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const ABILITY_HTML = `<div class="mw-heading"><h2>Abilities</h2><span class="mw-editsection">[edit]</span></div>
<style>.x{}</style>
<div class="ability-info-stats__stat"><div>COST:</div><div>55 mana</div></div>
<div class="ability-json"><p>Active: Ahri sends out her orb&#160;through enemies.</p></div>
<div>NOTICE TO API USERS:</div><div>Damage classifications are being amended across the wiki.</div>
<div class="tabbertab" title="Notes"><p>The orb passes through minions.</p></div>
<div class="tabbertab" title="Damage Info"><p>ApplyLifesteal</p></div>
<p>Damage Details noise Bucket:Damage.</p>`;

describe("wikiHtmlToText", () => {
  test("keeps descriptions and notes, drops edit links, stat rows, API notices and damage info", () => {
    const text = wikiHtmlToText(ABILITY_HTML);
    expect(text).toContain("Active: Ahri sends out her orb through enemies.");
    expect(text).toContain("The orb passes through minions.");
    expect(text).not.toContain("[edit]");
    expect(text).not.toContain("55 mana");
    expect(text).not.toContain("COST");
    expect(text).not.toContain("NOTICE TO API USERS");
    expect(text).not.toContain("Damage classifications");
    expect(text).not.toContain("ApplyLifesteal");
    expect(text).not.toContain("Bucket:Damage");
  });
});

describe("the wiki host restriction", () => {
  test("allows only https on the League of Legends Wiki", () => {
    expect(() => {
      assertWikiUrl(new URL(`https://${WIKI_HOST}/en-us/api.php`));
    }).not.toThrow();
    for (const url of [
      "https://example.com/en-us/api.php",
      `http://${WIKI_HOST}/en-us/api.php`,
      `https://${WIKI_HOST}.evil.example/api.php`,
    ]) {
      expect(() => {
        assertWikiUrl(new URL(url));
      }).toThrow("only");
    }
  });
});

/** A MediaWiki that answers the three calls the client makes, and records them. */
function mediaWiki(revid: number, abilitiesIndex = "1") {
  const requests: URL[] = [];
  const headers: Record<string, string>[] = [];
  const handler: WikiFetch = (url, init) => {
    requests.push(url);
    headers.push(init.headers);
    const action = url.searchParams.get("action");
    const prop = url.searchParams.get("prop");
    if (action === "query" && prop === "revisions|info") {
      const titles = (url.searchParams.get("titles") ?? "").split("|");
      const pages = Object.fromEntries(
        titles.map((title, index) => [
          String(index + 1),
          title === "Ahri/Abilities"
            ? undefined
            : title === "Nothing"
              ? { title, missing: "" }
              : {
                  title: title === "ahri" ? "Ahri" : title,
                  touched: "2026-01-01T00:00:00Z",
                  revisions: [{ revid }],
                },
        ]),
      );
      return Promise.resolve(
        Response.json({
          query: {
            normalized: titles.includes("ahri")
              ? [{ from: "ahri", to: "Ahri" }]
              : [],
            pages: Object.fromEntries(
              Object.entries(pages).filter(([, value]) => value !== undefined),
            ),
          },
        }),
      );
    }
    if (action === "parse" && prop === "sections") {
      return Promise.resolve(
        Response.json({
          parse: {
            sections: [
              { index: abilitiesIndex, line: "Abilities", level: "2" },
            ],
          },
        }),
      );
    }
    return Promise.resolve(
      Response.json(
        action === "parse" && prop === "text"
          ? { parse: { text: { "*": ABILITY_HTML } } }
          : { query: { search: [{ title: "Ahri" }] } },
      ),
    );
  };
  return { handler, requests, headers };
}

describe("the wiki client", () => {
  test("asks politely: one request at a time, a pause after each, a descriptive User-Agent", async () => {
    const wiki = mediaWiki(7);
    const pauses: number[] = [];
    let inFlight = 0;
    let overlap = false;
    const client = createWikiClient({
      cacheDirectory: directory,
      delayMs: 250,
      sleep: (milliseconds) => {
        pauses.push(milliseconds);
        return Promise.resolve();
      },
      fetch: async (url, init) => {
        inFlight += 1;
        overlap ||= inFlight > 1;
        const response = await wiki.handler(url, init);
        inFlight -= 1;
        return response;
      },
    });
    await Promise.all([client.page("Ahri"), client.page("Syndra")]);

    expect(overlap).toBe(false);
    expect(pauses.length).toBeGreaterThan(0);
    expect(pauses.every((pause) => pause === 250)).toBe(true);
    for (const header of wiki.headers) {
      expect(header["User-Agent"]).toBe(WIKI_USER_AGENT);
    }
    // Descriptive, names the product, and carries nothing personal.
    expect(WIKI_USER_AGENT).toContain("ScoutForLoL");
    expect(WIKI_USER_AGENT).not.toMatch(/@|jerred/iu);
    for (const url of wiki.requests) {
      expect(url.hostname).toBe(WIKI_HOST);
    }
  });

  test("reads the whole page when the Abilities section is transcluded and has no index", async () => {
    // Illaoi's page: its Abilities heading comes from a template, so the
    // section list gives it an empty index, and `section=` with nothing is an
    // API error that returns no `parse` at all.
    const wiki = mediaWiki(7, "");
    const client = createWikiClient({
      cacheDirectory: directory,
      delayMs: 0,
      fetch: wiki.handler,
    });
    const page = await client.page("Ahri");
    expect(page?.text).toContain("The orb passes through minions.");
    const parse = wiki.requests.find(
      (url) => url.searchParams.get("prop") === "text",
    );
    expect(parse?.searchParams.has("section")).toBe(false);
  });

  test("reads the Abilities section by revision and caches it by page and revision", async () => {
    const first = mediaWiki(7);
    const client = createWikiClient({
      cacheDirectory: directory,
      delayMs: 0,
      fetch: first.handler,
    });
    const page = await client.page("Ahri");
    expect(page).toMatchObject({ title: "Ahri", revid: 7 });
    expect(page?.text).toContain("The orb passes through minions.");
    const parse = first.requests.find(
      (url) => url.searchParams.get("prop") === "text",
    );
    expect(parse?.searchParams.get("oldid")).toBe("7");
    expect(parse?.searchParams.get("section")).toBe("1");
    expect(await readdir(directory)).toHaveLength(1);

    // A new client at the same revision downloads no page text.
    const again = mediaWiki(7);
    const second = createWikiClient({
      cacheDirectory: directory,
      delayMs: 0,
      fetch: again.handler,
    });
    const cachedPage = await second.page("Ahri");
    expect(cachedPage?.text).toBe(page?.text);
    expect(
      again.requests.filter(
        (url) => url.searchParams.get("action") === "parse",
      ),
    ).toHaveLength(0);

    // A new revision is downloaded again.
    const edited = mediaWiki(8);
    const third = createWikiClient({
      cacheDirectory: directory,
      delayMs: 0,
      fetch: edited.handler,
    });
    const newerPage = await third.page("Ahri");
    expect(newerPage?.revid).toBe(8);
    expect(await readdir(directory)).toHaveLength(2);
  });

  test("resolves normalized titles and reports missing pages", async () => {
    const wiki = mediaWiki(7);
    const client = createWikiClient({
      cacheDirectory: directory,
      delayMs: 0,
      fetch: wiki.handler,
    });
    const revisions = await client.revisions(["ahri", "Nothing"]);
    expect(revisions.get("ahri")).toMatchObject({ title: "Ahri", revid: 7 });
    expect(revisions.get("Nothing")).toBeUndefined();
    expect(await client.page("Nothing")).toBeUndefined();
  });

  test("retries a rate limit and fails loudly on a hard error", async () => {
    let calls = 0;
    const retrying = createWikiClient({
      cacheDirectory: directory,
      delayMs: 0,
      sleep: () => Promise.resolve(),
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? new Response("slow down", { status: 429 })
            : Response.json({ query: { search: [{ title: "Ahri" }] } }),
        );
      },
    });
    expect(await retrying.search("ahri")).toEqual(["Ahri"]);
    expect(calls).toBe(2);

    const failing = createWikiClient({
      cacheDirectory: directory,
      delayMs: 0,
      fetch: () => Promise.resolve(new Response("no", { status: 403 })),
    });
    await expect(failing.search("ahri")).rejects.toThrow("HTTP 403");
  });
});

describe("lookup and prefetch", () => {
  test("lookup returns a page with its revision, or the closest titles", async () => {
    const wiki = fakeWiki({
      Slow: "A slow reduces movement speed.",
      "Slow (status)": "x",
    });
    const found = await lookupWikiPage(wiki, " Slow ");
    expect(found.text).toContain("A slow reduces movement speed.");
    expect(found.pages).toEqual({ Slow: 1000 });
    const missing = await lookupWikiPage(wiki, "slo");
    expect(missing.pages).toEqual({});
    expect(missing.text).toContain("Closest titles");
    const nothing = await lookupWikiPage(wiki, "zzz");
    expect(nothing.text).toContain("nothing matches");
  });

  test("prefetch gives each champion's notes and records the page and patch-history revisions", async () => {
    const wiki = fakeWiki({
      Ahri: "ahri notes",
      "Ahri/Patch history": "h1",
      Syndra: "syndra notes",
    });
    const prefetched = await prefetchChampionWiki(wiki, ["Ahri", "Syndra"]);
    expect(prefetched.notes).toEqual(["ahri notes", "syndra notes"]);
    // Syndra has no patch-history page here, so only the pages that exist are recorded.
    expect(prefetched.pages).toEqual({
      Ahri: 1000,
      "Ahri/Patch history": 1001,
      Syndra: 1002,
    });
    await expect(prefetchChampionWiki(wiki, ["Nobody"])).rejects.toThrow(
      "no page for Nobody",
    );
  });
});
