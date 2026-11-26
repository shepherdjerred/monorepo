import { describe, expect, it } from "vitest";
import { ALLOWED_CDN_ORIGINS, EMPTY_BOARD_INDEX } from "#shared/contract.ts";
import { applyBoardOps } from "./board-ops.ts";
import { claimDecision } from "./claim.ts";
import { contentHeaders, contentSecurityPolicy } from "./csp.ts";
import { checkCsrf, type CsrfInput } from "./csrf.ts";
import { servedType } from "./content-types.ts";
import { mintContentToken, resolveContentPath } from "./paths.ts";
import { ifRangeMatches, noneMatch, parseRange } from "./range.ts";

const origins = {
  appOrigin: "https://app.example.test",
  contentOrigin: "https://content.example.test",
};
const TOKEN = "test-token-one-0000000000000000";

describe("content security policy", () => {
  const csp = contentSecurityPolicy(origins, TOKEN);
  const directive = (name: string) =>
    csp.split("; ").find((entry) => entry.startsWith(`${name} `)) ?? "";

  it("sandboxes without allow-same-origin or top navigation", () => {
    expect(
      csp.startsWith("sandbox allow-scripts allow-forms allow-popups;"),
    ).toBe(true);
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).not.toContain("allow-top-navigation");
  });

  it("scopes sources to the request's own token prefix", () => {
    const own = `${origins.contentOrigin}/_t/${TOKEN}/`;
    for (const name of [
      "script-src",
      "style-src",
      "font-src",
      "img-src",
      "media-src",
      "connect-src",
      "worker-src",
    ])
      expect(directive(name)).toContain(own);
    expect(directive("connect-src")).toBe(`connect-src ${own}`);
    expect(csp).not.toContain(`${origins.contentOrigin} `);
  });

  it("scopes to nothing for a path outside /_t/", () => {
    expect(contentSecurityPolicy(origins, null)).toContain(
      `${origins.contentOrigin}/_none/`,
    );
    expect(contentSecurityPolicy(origins, "bad token;x")).not.toContain(
      "bad token",
    );
  });

  it("builds script, style and font sources from the shared CDN list", () => {
    for (const cdn of ALLOWED_CDN_ORIGINS) {
      expect(directive("style-src")).toContain(cdn);
      expect(directive("font-src")).toContain(cdn);
    }
    expect(directive("script-src")).toContain("https://cdn.jsdelivr.net");
  });

  it("forbids forms, base, frames and objects, and frames only in the app", () => {
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain(`frame-ancestors ${origins.appOrigin}`);
  });

  it("sets the cross-origin headers and never frame-blocking ones", () => {
    const headers = contentHeaders(origins, TOKEN);
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("cross-origin");
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers).not.toHaveProperty("X-Frame-Options");
    expect(headers).not.toHaveProperty("Cross-Origin-Opener-Policy");
  });
});

describe("csrf matrix", () => {
  const base: CsrfInput = {
    method: "POST",
    appOrigin: origins.appOrigin,
    origin: origins.appOrigin,
    fetchSite: "same-origin",
    fetchMode: "cors",
    fetchDest: "empty",
  };
  const cases: [string, Partial<CsrfInput>, string | null][] = [
    ["same-origin POST", {}, null],
    ["same-origin GET without Origin", { method: "GET", origin: null }, null],
    [
      "CLI POST (no headers)",
      { origin: null, fetchSite: null, fetchMode: null, fetchDest: null },
      null,
    ],
    ["CLI GET", { method: "GET", origin: null, fetchSite: null }, null],
    ["same-site", { fetchSite: "same-site" }, "cross-site"],
    [
      "same-site GET",
      { method: "GET", origin: null, fetchSite: "same-site" },
      "cross-site",
    ],
    ["cross-site", { fetchSite: "cross-site" }, "cross-site"],
    ["content origin", { origin: origins.contentOrigin }, "origin-mismatch"],
    ["Origin: null", { origin: "null" }, "origin-mismatch"],
    [
      "Origin: null on GET",
      { method: "GET", origin: "null", fetchSite: null },
      "origin-mismatch",
    ],
    ["browser POST without Origin", { origin: null }, "missing-origin"],
    [
      "typed-URL navigation",
      {
        method: "GET",
        origin: null,
        fetchSite: "none",
        fetchMode: "navigate",
        fetchDest: "document",
      },
      null,
    ],
    [
      "fetch with site none",
      {
        method: "GET",
        origin: null,
        fetchSite: "none",
        fetchMode: "cors",
        fetchDest: "empty",
      },
      "navigation-only",
    ],
    [
      "POST with site none",
      {
        origin: null,
        fetchSite: "none",
        fetchMode: "navigate",
        fetchDest: "document",
      },
      "navigation-only",
    ],
  ];
  it.each(cases)("%s", (_name, overrides, expected) => {
    expect(checkCsrf({ ...base, ...overrides })).toBe(expected);
  });
});

describe("range parsing", () => {
  it("serves the whole body without a header or for a bad one", () => {
    expect(parseRange(null, 100)).toEqual({ type: "full" });
    expect(parseRange("items=0-1", 100)).toEqual({ type: "full" });
    expect(parseRange("bytes=0-1,5-9", 100)).toEqual({ type: "full" });
    expect(parseRange("bytes=-", 100)).toEqual({ type: "full" });
    expect(parseRange("bytes=9-3", 100)).toEqual({ type: "full" });
  });
  it("parses closed, open-ended and suffix ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({
      type: "partial",
      start: 0,
      end: 9,
    });
    expect(parseRange("bytes=90-", 100)).toEqual({
      type: "partial",
      start: 90,
      end: 99,
    });
    expect(parseRange("bytes=-10", 100)).toEqual({
      type: "partial",
      start: 90,
      end: 99,
    });
    expect(parseRange("bytes=-500", 100)).toEqual({
      type: "partial",
      start: 0,
      end: 99,
    });
    expect(parseRange("bytes=50-5000", 100)).toEqual({
      type: "partial",
      start: 50,
      end: 99,
    });
  });
  it("is unsatisfiable past the end, for an empty suffix and for empty bodies", () => {
    expect(parseRange("bytes=100-", 100)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("bytes=-0", 100)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("bytes=0-0", 0)).toEqual({ type: "unsatisfiable" });
    expect(parseRange("bytes=-5", 0)).toEqual({ type: "unsatisfiable" });
  });
  it("matches If-Range and If-None-Match on strong tags", () => {
    expect(ifRangeMatches(null, '"a"')).toBe(true);
    expect(ifRangeMatches('"a"', '"a"')).toBe(true);
    expect(ifRangeMatches('"b"', '"a"')).toBe(false);
    expect(noneMatch('"b", "a"', '"a"')).toBe(true);
    expect(noneMatch("*", '"a"')).toBe(true);
    expect(noneMatch(null, '"a"')).toBe(false);
    expect(noneMatch('"b"', '"a"')).toBe(false);
  });
});

describe("content paths", () => {
  it("maps the root to the entry and a trailing slash to index.html", () => {
    expect(resolveContentPath("", "app/main.html")).toEqual({
      type: "path",
      path: "app/main.html",
    });
    expect(resolveContentPath("docs/", "x.html")).toEqual({
      type: "path",
      path: "docs/index.html",
    });
    expect(resolveContentPath("assets/a%20b.js", "x.html")).toEqual({
      type: "path",
      path: "assets/a b.js",
    });
  });
  it.each([
    "../secret",
    "a/../../b",
    "%2e%2e/secret",
    "a/%2e%2e/%2e%2e/b",
    "a%2f..%2fb",
    "a%5cb",
    "a%00b",
    "%E0%A4%A",
    "_t/x",
    "./a",
    "a//b",
  ])("rejects %s", (raw) => {
    expect(resolveContentPath(raw, "x.html")).toEqual({ type: "invalid" });
  });
  it("mints 32-character base64url tokens", () => {
    const token = mintContentToken();
    expect(token).toMatch(/^[\w-]{32}$/u);
    expect(mintContentToken()).not.toBe(token);
  });
});

describe("served types", () => {
  it("serves known types inline and everything else as a download", () => {
    expect(servedType("text/html; charset=utf-8")).toEqual({
      contentType: "text/html; charset=utf-8",
      inline: true,
    });
    expect(servedType("application/pdf").inline).toBe(true);
    expect(servedType("font/woff2").inline).toBe(true);
    expect(servedType("application/x-msdownload")).toEqual({
      contentType: "application/octet-stream",
      inline: false,
    });
    expect(servedType("text/html\r\nSet-Cookie: x=1").inline).toBe(false);
    expect(servedType("").inline).toBe(false);
  });
});

describe("claim predicate", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const policy = { now, actorId: "me", orphanMs: 15 * 60_000 };
  const held = (actorId: string, ackedAt: Date | null, minutesAgo: number) => ({
    delivery: {
      actorId,
      ackedAt,
      actorLastSeenAt: new Date(now.getTime() - minutesAgo * 60_000),
    },
  });
  it("claims an unclaimed comment", () => {
    expect(claimDecision({ delivery: null }, policy)).toBe("claim");
  });
  it("retries the caller's unacknowledged comment and never an acknowledged one", () => {
    expect(claimDecision(held("me", null, 0), policy)).toBe("retry");
    expect(claimDecision(held("me", now, 0), policy)).toBe("skip");
  });
  it("leaves a live actor's comment alone and takes an orphan's", () => {
    expect(claimDecision(held("other", null, 5), policy)).toBe("skip");
    expect(claimDecision(held("other", now, 14), policy)).toBe("skip");
    expect(claimDecision(held("other", null, 16), policy)).toBe("takeover");
    expect(claimDecision(held("other", now, 60), policy)).toBe("takeover");
  });
});

describe("board operations", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const C = "33333333-3333-4333-8333-333333333333";
  const placed = applyBoardOps(EMPTY_BOARD_INDEX, [
    { op: "placeFrame", artifactId: A, w: 390, h: 844 },
    { op: "placeFrame", artifactId: B, w: 390, h: 844 },
  ]);

  it("places frames left to right with a gap and in z order", () => {
    expect(placed.frames[A]).toMatchObject({ x: 0, y: 0, page: 0 });
    expect(placed.frames[B]).toMatchObject({ x: 430, y: 0 });
    expect(placed.order).toEqual([A, B]);
  });
  it("places to the right of a named frame and keeps an existing frame in place", () => {
    const next = applyBoardOps(placed, [
      { op: "placeFrame", artifactId: C, w: 100, h: 100, rightOf: A },
      { op: "placeFrame", artifactId: A, w: 1, h: 1 },
    ]);
    expect(next.frames[C]).toMatchObject({ x: 430, y: 0 });
    expect(next.frames[A]).toMatchObject({ x: 0, w: 390 });
    expect(next.order).toEqual([A, B, C]);
  });
  it("moves frames and ignores unknown ones and unknown pages", () => {
    const next = applyBoardOps(placed, [
      {
        op: "moveFrames",
        moves: [
          { artifactId: A, x: 5, y: 6, page: 9 },
          { artifactId: C, x: 1, y: 1 },
        ],
      },
    ]);
    expect(next.frames[A]).toMatchObject({ x: 5, y: 6, page: 0 });
    expect(C in next.frames).toBe(false);
  });
  it("resizes in a move and leaves the size alone otherwise", () => {
    const resized = applyBoardOps(placed, [
      {
        op: "moveFrames",
        moves: [{ artifactId: A, x: 5, y: 6, w: 800, h: 500 }],
      },
    ]);
    expect(resized.frames[A]).toMatchObject({ x: 5, y: 6, w: 800, h: 500 });
    const moved = applyBoardOps(resized, [
      { op: "moveFrames", moves: [{ artifactId: A, x: 7, y: 8 }] },
    ]);
    expect(moved.frames[A]).toMatchObject({ x: 7, y: 8, w: 800, h: 500 });
  });
  it("reorders without losing or duplicating ids", () => {
    const next = applyBoardOps(placed, [
      { op: "reorder", order: [B, B, C, "zzz"] },
    ]);
    expect(next.order).toEqual([B, A]);
  });
  it("puts and deletes notes, clamping the page", () => {
    const note = {
      type: "sticky",
      page: 4,
      x: 1,
      y: 1,
      w: 10,
      h: 10,
      text: "hi",
    } as const;
    const next = applyBoardOps(placed, [{ op: "putNote", id: "n1", note }]);
    expect(next.notes["n1"]).toMatchObject({ page: 0, text: "hi" });
    expect(next.order).toEqual([A, B, "n1"]);
    const gone = applyBoardOps(next, [
      { op: "deleteNote", id: "n1" },
      { op: "deleteNote", id: "missing" },
    ]);
    expect(gone.notes).toEqual({});
    expect(gone.order).toEqual([A, B]);
  });
  it("refuses a note that would shadow a frame id", () => {
    const note = {
      type: "title",
      page: 0,
      x: 0,
      y: 0,
      text: "t",
      size: "m",
    } as const;
    expect(
      applyBoardOps(placed, [{ op: "putNote", id: A, note }]).notes,
    ).toEqual({});
  });
  it("removes a frame and its launch pointer", () => {
    const launched = applyBoardOps(placed, [
      { op: "setLaunch", launch: { view: "focused", artifactId: A } },
    ]);
    expect(launched.launch.artifactId).toBe(A);
    const next = applyBoardOps(launched, [
      { op: "removeFrame", artifactId: A },
      { op: "removeFrame", artifactId: C },
    ]);
    expect(next.frames[A]).toBeUndefined();
    expect(next.launch).toEqual({ view: "focused" });
    expect(next.order).toEqual([B]);
  });
  it("drops a launch artifact the board does not hold", () => {
    const next = applyBoardOps(placed, [
      { op: "setLaunch", launch: { view: "focused", artifactId: C } },
    ]);
    expect(next.launch).toEqual({ view: "focused" });
  });
});
