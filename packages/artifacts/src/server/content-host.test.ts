import { beforeAll, describe, expect, it, vi } from "vitest";
import { ALLOWED_CDN_ORIGINS } from "#shared/contract.ts";
import { OTHER_TOKEN, TOKEN, publishFixture } from "#testing/fixtures.ts";
import {
  CONTENT_ORIGIN,
  createTestRuntime,
  type TestRuntime,
} from "#testing/runtime.ts";
import { headerOf, statusOf, textOf } from "#testing/response.ts";

const BODY = "0123456789".repeat(10);
const HTML = `<!doctype html><html><head><title>t</title></head><body>hi</body></html>`;

let runtime: TestRuntime;
let etag = "";

beforeAll(async () => {
  runtime = await createTestRuntime();
  const { entries } = await publishFixture(runtime, {
    "index.html": { body: HTML, mediaType: "text/html; charset=utf-8" },
    "data.bin.txt": { body: BODY, mediaType: "text/plain" },
    "notes.md": {
      body: "# Title\n\n<script>alert(1)</script>\n",
      mediaType: "text/markdown",
    },
    "tool.exe": { body: "MZ", mediaType: "application/x-msdownload" },
    "docs/index.html": { body: "<p>docs</p>", mediaType: "text/html" },
  });
  etag = `"${entries["data.bin.txt"]?.sha256 ?? ""}"`;
  await publishFixture(
    runtime,
    { "other.txt": { body: "x", mediaType: "text/plain" } },
    {
      token: OTHER_TOKEN,
      versionId: "33333333-3333-4333-8333-333333333333",
      entryPath: "other.txt",
    },
  );
});

async function expectRange(
  range: string,
  expected: string,
  contentRange: string,
) {
  const response = await get(`/_t/${TOKEN}/data.bin.txt`, {
    headers: { Range: range },
  });
  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe(contentRange);
  expect(await response.text()).toBe(expected);
}

const get = (path: string, init: Parameters<TestRuntime["call"]>[2] = {}) =>
  runtime.call("content", path, init);

describe("content host: sandbox headers on every status", () => {
  const cases: [string, () => Promise<Response>, number][] = [
    ["200 html", () => get(`/_t/${TOKEN}/`), 200],
    ["200 file", () => get(`/_t/${TOKEN}/data.bin.txt`), 200],
    [
      "206",
      () =>
        get(`/_t/${TOKEN}/data.bin.txt`, { headers: { Range: "bytes=0-9" } }),
      206,
    ],
    [
      "304",
      () =>
        get(`/_t/${TOKEN}/data.bin.txt`, {
          headers: { "If-None-Match": etag },
        }),
      304,
    ],
    ["404 unknown path", () => get(`/_t/${TOKEN}/missing.txt`), 404],
    ["404 unknown token", () => get(`/_t/${"x".repeat(32)}/index.html`), 404],
    ["404 outside /_t/", () => get("/anything"), 404],
    [
      "416",
      () =>
        get(`/_t/${TOKEN}/data.bin.txt`, { headers: { Range: "bytes=500-" } }),
      416,
    ],
    ["308", () => get(`/_t/${TOKEN}`), 308],
    ["400 traversal", () => get(`/_t/${TOKEN}/%2e%2e%2fsecret`), 400],
    ["403 no login", () => get(`/_t/${TOKEN}/`, { login: null }), 403],
    [
      "403 foreign login",
      () => get(`/_t/${TOKEN}/`, { login: "intruder@example.test" }),
      403,
    ],
    [
      "204 options",
      () => get(`/_t/${TOKEN}/data.bin.txt`, { method: "OPTIONS" }),
      204,
    ],
    [
      "404 post",
      () => get(`/_t/${TOKEN}/index.html`, { method: "POST", body: "x" }),
      404,
    ],
    [
      "200 head",
      () => get(`/_t/${TOKEN}/data.bin.txt`, { method: "HEAD" }),
      200,
    ],
    ["200 bridge", () => get("/_bridge/v1.js"), 200],
  ];
  it.each(cases)(
    "%s carries the sandbox CSP and cross-origin headers",
    async (_name, request, status) => {
      const response = await request();
      expect(response.status).toBe(status);
      const csp = response.headers.get("Content-Security-Policy") ?? "";
      expect(
        csp.startsWith("sandbox allow-scripts allow-forms allow-popups;"),
      ).toBe(true);
      expect(csp).not.toContain("allow-same-origin");
      expect(csp).not.toContain("allow-top-navigation");
      expect(csp).toContain("frame-ancestors https://app.example.test");
      expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
        "cross-origin",
      );
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("X-Frame-Options")).toBeNull();
      expect(response.headers.get("Cross-Origin-Opener-Policy")).toBeNull();
    },
  );

  it("scopes CSP sources to the request's own token prefix", async () => {
    const mine =
      (await headerOf(
        get(`/_t/${TOKEN}/data.bin.txt`),
        "Content-Security-Policy",
      )) ?? "";
    const theirs =
      (await headerOf(
        get(`/_t/${OTHER_TOKEN}/other.txt`),
        "Content-Security-Policy",
      )) ?? "";
    expect(mine).toContain(`${CONTENT_ORIGIN}/_t/${TOKEN}/`);
    expect(mine).not.toContain(OTHER_TOKEN);
    expect(theirs).toContain(`${CONTENT_ORIGIN}/_t/${OTHER_TOKEN}/`);
    expect(theirs).not.toContain(TOKEN);
    expect(mine).toContain("connect-src " + `${CONTENT_ORIGIN}/_t/${TOKEN}/`);
    for (const cdn of ALLOWED_CDN_ORIGINS) expect(mine).toContain(cdn);
  });
});

describe("content host: routes", () => {
  it("404s /trpc, /api and every other path", async () => {
    for (const path of [
      "/trpc/boards.list",
      "/api/uploads",
      "/api/feedback/stream",
      "/healthz",
      "/",
    ])
      expect(await statusOf(get(path))).toBe(404);
  });

  it("404s every method but GET, HEAD and OPTIONS", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"])
      expect(
        await statusOf(get(`/_t/${TOKEN}/index.html`, { method, body: "x" })),
      ).toBe(404);
  });

  it("answers a preflight with the allowed methods and headers", async () => {
    const response = await get(`/_t/${TOKEN}/data.bin.txt`, {
      method: "OPTIONS",
    });
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, HEAD, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "Range",
    );
  });

  it("redirects a token without a trailing slash and keeps the query", async () => {
    const response = await get(`/_t/${TOKEN}?a=1`);
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(`/_t/${TOKEN}/?a=1`);
  });

  it("serves the entry at / and index.html for a trailing slash, with no SPA fallback", async () => {
    expect(await textOf(get(`/_t/${TOKEN}/`))).toContain("hi");
    expect(await textOf(get(`/_t/${TOKEN}/docs/`))).toContain("<p>docs</p>");
    expect(await statusOf(get(`/_t/${TOKEN}/nope/deep`))).toBe(404);
  });

  it.each([
    "../secret",
    "%2e%2e/secret",
    "a/%2e%2e/%2e%2e/b",
    "a%5cb",
    "a%00b",
    "%E0%A4%A",
    "_bridge/v1.js",
  ])("rejects the path %s", async (path) => {
    const response = await get(`/_t/${TOKEN}/${path}`);
    expect([400, 404]).toContain(response.status);
    expect(await response.text()).not.toContain("alert");
  });

  it("serves the bridge under a stable alias and a content hash", async () => {
    const alias = await get("/_bridge/v1.js");
    expect(alias.headers.get("Content-Type")).toContain("text/javascript");
    expect(alias.headers.get("Cache-Control")).toContain("immutable");
    const source = await alias.text();
    expect(source).toContain(
      CONTENT_ORIGIN.length > 0 ? "https://app.example.test" : "",
    );
    expect(source).not.toContain("__APP_ORIGIN__");
    const hashed = /\/_bridge\/([0-9a-f]{16})\.js/u.exec(
      await textOf(get(`/_t/${TOKEN}/`)),
    );
    expect(hashed).not.toBeNull();
    expect(await textOf(get(`/_bridge/${hashed?.[1] ?? ""}.js`))).toBe(source);
  });
});

describe("content host: bytes", () => {
  it("serves the whole body with a strong ETag and immutable private caching", async () => {
    const response = await get(`/_t/${TOKEN}/data.bin.txt`);
    expect(await response.text()).toBe(BODY);
    expect(response.headers.get("ETag")).toBe(etag);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(response.headers.get("Content-Length")).toBe(String(BODY.length));
  });

  it("answers closed, open-ended and suffix ranges with 206", async () => {
    await expectRange("bytes=0-9", BODY.slice(0, 10), "bytes 0-9/100");
    await expectRange("bytes=95-", BODY.slice(95), "bytes 95-99/100");
    await expectRange("bytes=-5", BODY.slice(95), "bytes 95-99/100");
  });

  it("answers an unsatisfiable range with 416 and the size", async () => {
    const response = await get(`/_t/${TOKEN}/data.bin.txt`, {
      headers: { Range: "bytes=100-200" },
    });
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */100");
  });

  it("sends the whole body for a multi-range or a stale If-Range", async () => {
    const multi = await get(`/_t/${TOKEN}/data.bin.txt`, {
      headers: { Range: "bytes=0-1,5-6" },
    });
    expect(multi.status).toBe(200);
    expect(await multi.text()).toBe(BODY);
    const stale = await get(`/_t/${TOKEN}/data.bin.txt`, {
      headers: { Range: "bytes=0-1", "If-Range": '"stale"' },
    });
    expect(stale.status).toBe(200);
    const fresh = await get(`/_t/${TOKEN}/data.bin.txt`, {
      headers: { Range: "bytes=0-1", "If-Range": etag },
    });
    expect(fresh.status).toBe(206);
  });

  it("answers 304 from the validator alone and HEAD without a body", async () => {
    const response = await get(`/_t/${TOKEN}/data.bin.txt`, {
      headers: { "If-None-Match": etag },
    });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    const head = await get(`/_t/${TOKEN}/data.bin.txt`, { method: "HEAD" });
    expect(head.headers.get("Content-Length")).toBe("100");
    expect(await head.text()).toBe("");
  });

  it("serves unknown media types as an attachment download", async () => {
    const response = await get(`/_t/${TOKEN}/tool.exe`);
    expect(response.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("does not render markdown: raw bytes, plain markdown type", async () => {
    const response = await get(`/_t/${TOKEN}/notes.md`);
    expect(response.headers.get("Content-Type")).toBe("text/markdown");
    expect(await response.text()).toBe(
      "# Title\n\n<script>alert(1)</script>\n",
    );
  });
});

describe("content host: HTML", () => {
  it("injects the bridge, versions the ETag and refuses Range", async () => {
    const response = await get(`/_t/${TOKEN}/`, {
      headers: { Range: "bytes=0-5" },
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toMatch(
      /<html><script src="\/_bridge\/[0-9a-f]{16}\.js"><\/script><head>/u,
    );
    expect(response.headers.get("ETag")).toMatch(
      /^"[0-9a-f]{64}-b[0-9a-f]{8}"$/u,
    );
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Accept-Ranges")).toBeNull();
  });

  it("renders a Mermaid artifact's viewer at the token root, with a relative source", async () => {
    const mermaid = await createTestRuntime();
    await publishFixture(
      mermaid,
      { "diagram.mmd": { body: "graph TD; A-->B", mediaType: "text/plain" } },
      { kind: "mermaid", entryPath: "diagram.mmd" },
    );
    const response = await mermaid.call("content", `/_t/${TOKEN}/`);
    const html = await response.text();
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain('data-source="./diagram.mmd"');
    expect(html).toMatch(
      /<script type="module" src="\/_viewer\/mermaid-viewer-\w+\.js">/u,
    );
    const script = /src="(\/_viewer\/[^"]+)"/u.exec(html)?.[1] ?? "";
    const asset = await mermaid.call("content", script);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Content-Type")).toContain("text/javascript");
    expect(
      await statusOf(mermaid.call("content", `/_t/${TOKEN}/diagram.mmd`)),
    ).toBe(200);
  }, 60_000);
});

describe("content host: failures", () => {
  it("answers an unexpected failure with 500 and the sandbox headers, and logs no token", async () => {
    const broken = await createTestRuntime();
    const { entries } = await publishFixture(broken, {
      "index.html": { body: HTML, mediaType: "text/html" },
    });
    await broken.store.delete(entries["index.html"]?.storageKey ?? "");
    const error = vi.spyOn(console, "error").mockImplementation(vi.fn());
    try {
      const response = await broken.call("content", `/_t/${TOKEN}/`);
      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "sandbox allow-scripts",
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(error.mock.calls.flat().join("\n")).not.toContain(TOKEN);
    } finally {
      error.mockRestore();
    }
  });
});

describe("content host: tokens", () => {
  it("404s a rotated token at once, even when it was cached", async () => {
    const rotating = await createTestRuntime();
    await publishFixture(rotating, {
      "index.html": { body: HTML, mediaType: "text/html" },
    });
    expect(await statusOf(rotating.call("content", `/_t/${TOKEN}/`))).toBe(200);
    rotating.catalog.removeToken(TOKEN);
    rotating.services.deps.tokens.invalidateToken(TOKEN);
    expect(await statusOf(rotating.call("content", `/_t/${TOKEN}/`))).toBe(404);
  });

  it("never writes a token to a log line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const error = vi.spyOn(console, "error").mockImplementation(vi.fn());
    try {
      await get(`/_t/${TOKEN}/`);
      await get(`/_t/${TOKEN}/missing`);
      await get(`/_t/${TOKEN}/%2e%2e%2fx`);
      await get(`/_t/${TOKEN}/data.bin.txt`, {
        headers: { Range: "bytes=1000-" },
      });
      const logged = [...warn.mock.calls, ...error.mock.calls]
        .flat()
        .join("\n");
      expect(logged).not.toContain(TOKEN);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
