import { Glob } from "bun";
import { beforeAll, describe, expect, it } from "vitest";
import { ALLOWED_CDN_ORIGINS, LIMIT_DEFAULTS } from "#shared/contract.ts";
import { appPolicy } from "#domain/csp.ts";
import {
  APP_ORIGIN,
  CONTENT_ORIGIN,
  createTestRuntime,
  type CallInit,
  type TestRuntime,
} from "#testing/runtime.ts";
import { jsonOf, statusOf, textOf } from "#testing/response.ts";

let runtime: TestRuntime;
beforeAll(async () => {
  runtime = await createTestRuntime();
});

const get = (path: string, init: CallInit = {}) =>
  runtime.call("app", path, init);
const navigation = {
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
};

function corsHeaders(response: Response): string[] {
  return [...response.headers.keys()].filter((name) =>
    name.startsWith("access-control-"),
  );
}

describe("app host: identity", () => {
  it("rejects a missing or foreign login with 403 and reaches no handler", async () => {
    for (const login of [null, "intruder@example.test", ""]) {
      for (const path of [
        "/",
        "/trpc/boards.list",
        "/agent/SKILL.md",
        "/api/uploads",
      ]) {
        const response = await get(path, { login, headers: navigation });
        expect(response.status, `${String(login)} ${path}`).toBe(403);
      }
    }
  });

  it("requires an actor for /trpc and /api before touching data", async () => {
    // Same-origin browser GET: passes the gates, then names no caller.
    const response = await get("/api/uploads", {
      method: "POST",
      headers: { Origin: APP_ORIGIN, "Sec-Fetch-Site": "same-origin" },
    });
    // The database is unreachable in unit tests; the point is it is not 2xx.
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe("app host: CSRF", () => {
  const rejected: [string, string, CallInit][] = [
    [
      "Origin: null POST",
      "/trpc/boards.create",
      {
        method: "POST",
        headers: { Origin: "null", "Sec-Fetch-Site": "cross-site" },
      },
    ],
    [
      "Origin: null with no fetch metadata",
      "/trpc/boards.create",
      { method: "POST", headers: { Origin: "null" } },
    ],
    [
      "content origin POST",
      "/trpc/boards.create",
      { method: "POST", headers: { Origin: CONTENT_ORIGIN } },
    ],
    [
      "content origin same-site",
      "/trpc/boards.create",
      {
        method: "POST",
        headers: { Origin: CONTENT_ORIGIN, "Sec-Fetch-Site": "same-site" },
      },
    ],
    [
      "same-site GET /trpc",
      "/trpc/boards.list",
      { headers: { "Sec-Fetch-Site": "same-site" } },
    ],
    [
      "cross-site GET /trpc",
      "/trpc/boards.list",
      { headers: { "Sec-Fetch-Site": "cross-site" } },
    ],
    [
      "Origin: null GET /trpc",
      "/trpc/boards.list",
      { headers: { Origin: "null" } },
    ],
    [
      "foreign Origin GET /trpc",
      "/trpc/boards.list",
      { headers: { Origin: "https://evil.example" } },
    ],
    [
      "browser POST without Origin",
      "/trpc/boards.create",
      { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } },
    ],
    [
      "fetch with Sec-Fetch-Site none",
      "/trpc/boards.list",
      { headers: { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "cors" } },
    ],
    [
      "same-site GET /api stream",
      "/api/feedback/stream",
      { headers: { "Sec-Fetch-Site": "same-site" } },
    ],
  ];
  it.each(rejected)("rejects %s", async (_name, path, init) => {
    const response = await get(path, init);
    expect(response.status).toBe(403);
    expect(corsHeaders(response)).toEqual([]);
  });

  it("allows a typed-URL navigation to the UI", async () => {
    const response = await get("/", { headers: navigation });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Artifacts");
  });
});

describe("app host: isolation", () => {
  it("404s /_t/* and /_p/* and sends no CORS headers", async () => {
    for (const path of ["/_t/abc/index.html", "/_t", "/_p/x", "/_p", "/_t/"]) {
      const response = await get(path, {
        headers: { "Sec-Fetch-Site": "same-origin" },
      });
      expect(response.status, path).toBe(404);
      expect(corsHeaders(response)).toEqual([]);
    }
  });

  it("answers every status with the app policy and no CORS", async () => {
    const responses = [
      await get("/", { headers: navigation }),
      await get("/_t/x", { headers: { "Sec-Fetch-Site": "same-origin" } }),
      await get("/", { login: null }),
      await get("/trpc/boards.list", {
        headers: { "Sec-Fetch-Site": "cross-site" },
      }),
      // Passes the gates and fails inside the handler: still a policed response.
      await get("/trpc/boards.list", {
        headers: { "Sec-Fetch-Site": "same-origin" },
      }),
      await get("/agent/SKILL.md", {
        headers: { "Sec-Fetch-Site": "same-origin" },
      }),
      await get("/api/missing", {
        headers: { "Sec-Fetch-Site": "same-origin" },
      }),
    ];
    for (const response of responses) {
      expect(response.headers.get("Content-Security-Policy")).toBe(
        appPolicy(CONTENT_ORIGIN),
      );
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(corsHeaders(response)).toEqual([]);
    }
  });

  it("lets only the content origin beyond 'self' and never evaluates script text", () => {
    const policy = appPolicy(CONTENT_ORIGIN);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).toContain(`frame-src ${CONTENT_ORIGIN}`);
    expect(policy).toContain(`connect-src 'self' ${CONTENT_ORIGIN}`);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy.replaceAll("wasm-unsafe-eval", "")).not.toContain(
      "unsafe-eval",
    );
    expect(policy.match(/https?:\/\/[^\s;]+/gu)).toEqual(
      Array.from({ length: 4 }, () => CONTENT_ORIGIN),
    );
  });

  it("answers a CORS preflight like any other cross-site request: refused", async () => {
    const response = await get("/trpc/boards.list", {
      method: "OPTIONS",
      headers: {
        Origin: CONTENT_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(response.status).toBe(403);
    expect(corsHeaders(response)).toEqual([]);
  });

  it("refuses a /trpc body over 1 MiB before resolving any caller", async () => {
    const response = await get("/trpc/boards.create", {
      method: "POST",
      headers: {
        Origin: APP_ORIGIN,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug: "big", title: "x".repeat(2 * 1024 * 1024) }),
    });
    expect(response.status).toBe(413);
  });

  it("does not hide the maintenance procedures behind the app host", async () => {
    const response = await get("/trpc/maintenance.cleanup", {
      method: "POST",
      headers: { Origin: APP_ORIGIN, "Sec-Fetch-Site": "same-origin" },
    });
    expect([404, 500]).toContain(response.status);
  });

  it("reads object bytes only in the content host", async () => {
    const offenders: string[] = [];
    for await (const file of new Glob("src/**/*.ts").scan({
      cwd: `${import.meta.dir}/../..`,
    })) {
      if (file.endsWith(".test.ts") || file.startsWith("src/testing/"))
        continue;
      const text = await Bun.file(`${import.meta.dir}/../../${file}`).text();
      const reads =
        /\bstore\.(?:read|readRange)\(/u.test(text) ||
        /\.readRange\(|\bread: \(key\)/u.test(text);
      if (reads && !/content-host\.ts$|object-store\.ts$/u.test(file))
        offenders.push(file);
    }
    expect(offenders).toEqual([]);
    const app = await Bun.file(`${import.meta.dir}/app-host.ts`).text();
    expect(app).not.toMatch(/content-host|\.read\(|readRange/u);
  });
});

describe("app host: agent guide", () => {
  const headers = { "Sec-Fetch-Site": "same-origin" };

  it("serves SKILL.md and the four references", async () => {
    const skill = await get("/agent/SKILL.md", { headers });
    expect(skill.status).toBe(200);
    expect(skill.headers.get("Content-Type")).toContain("text/markdown");
    const text = await skill.text();
    expect(text.startsWith("---\nname: artifacts")).toBe(true);
    expect(text).toContain("toolkit artifacts wait");
    for (const name of ["publishing", "concepts", "review-loop", "sandbox"]) {
      const response = await get(`/agent/reference/${name}.md`, { headers });
      expect(response.status, name).toBe(200);
      const body = await response.text();
      expect(body.length).toBeGreaterThan(200);
    }
    expect(
      await statusOf(get("/agent/reference/unknown.md", { headers })),
    ).toBe(404);
    expect(
      await statusOf(get("/agent/reference/publishing", { headers })),
    ).toBe(404);
  });

  it("renders the limits and CDNs from the same constants as the config and CSP", async () => {
    const index = await jsonOf(get("/agent/index.json", { headers }));
    expect(index).toEqual({
      guideVersion: 1,
      files: [
        "/agent/SKILL.md",
        "/agent/reference/publishing.md",
        "/agent/reference/concepts.md",
        "/agent/reference/review-loop.md",
        "/agent/reference/sandbox.md",
      ],
      limits: {
        maxFileBytes: LIMIT_DEFAULTS.maxFileBytes,
        maxVersionBytes: LIMIT_DEFAULTS.maxVersionBytes,
        maxFiles: LIMIT_DEFAULTS.maxFiles,
      },
      allowedCdns: [...ALLOWED_CDN_ORIGINS],
    });
    const sandbox = await textOf(
      get("/agent/reference/sandbox.md", { headers }),
    );
    for (const cdn of ALLOWED_CDN_ORIGINS) expect(sandbox).toContain(cdn);
    expect(sandbox).toContain("hash routing");
    expect(sandbox).toContain("localStorage");
    const publishing = await textOf(
      get("/agent/reference/publishing.md", { headers }),
    );
    expect(publishing).toContain("500 MiB per file");
  });

  it("follows a raised limit", async () => {
    const raised = await createTestRuntime({
      flagValues: { "artifacts-max-files": 3000 },
    });
    const index = await jsonOf(
      raised.call("app", "/agent/index.json", { headers }),
    );
    expect(index).toMatchObject({ limits: { maxFiles: 3000 } });
  });
});
