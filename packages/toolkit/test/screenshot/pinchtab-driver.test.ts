import http from "node:http";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createPinchtabHttpClient } from "#lib/pinchtab-cli/client.ts";
import { resolvePinchtabConnection } from "#lib/pinchtab-cli/http.ts";
import {
  captureScreenshot,
  type PinchtabDriverClient,
} from "#lib/screenshot/pinchtab-driver.ts";
import { createPinchtabLease } from "#lib/screenshot/pinchtab-lease.ts";

function makeFakeClient(overrides: Partial<PinchtabDriverClient> = {}): {
  client: PinchtabDriverClient;
  events: string[];
} {
  const events: string[] = [];
  const client: PinchtabDriverClient = {
    createSession: (agentId) => {
      events.push("createSession");
      return Promise.resolve({
        success: true,
        data: {
          id: "ses_test_1",
          agentId,
          sessionToken: "tok_test_1",
          status: "active",
        },
      });
    },
    revokeSession: (id) => {
      events.push(`revokeSession:${id}`);
      return Promise.resolve({ success: true, data: "revoked" });
    },
    navigateNewTab: (_token, url) => {
      events.push(`navigateNewTab:${url}`);
      return Promise.resolve({ success: true, data: "tab_test_1" });
    },
    navigateTab: (_token, tabId, url) => {
      events.push(`navigateTab:${tabId}:${url}`);
      return Promise.resolve({ success: true, data: tabId });
    },
    setViewport: () => Promise.resolve({ success: true, data: "ok" }),
    setMedia: () => Promise.resolve({ success: true, data: "ok" }),
    countSelector: (_token, _tabId, selector) =>
      Promise.resolve({ success: true, data: { selector, count: 1 } }),
    currentUrl: () =>
      Promise.resolve({ success: true, data: "http://localhost:5180/app/" }),
    screenshot: (_token, tabId, outPath) => {
      events.push(`screenshot:${tabId}`);
      return Promise.resolve({ success: true, data: outPath });
    },
    closeTab: (_token, tabId) => {
      events.push(`closeTab:${tabId}`);
      return Promise.resolve({ success: true, data: "closed" });
    },
    ...overrides,
  };
  return { client, events };
}

describe("pinchtab lease tracking & tab cleanup", () => {
  let tempTendDir = "";
  const prevTendDir = Bun.env["TOOLKIT_TEND_DIR"];

  beforeEach(async () => {
    tempTendDir = await mkdtemp(nodePath.join(os.tmpdir(), "toolkit-tend-"));
    Bun.env["TOOLKIT_TEND_DIR"] = tempTendDir;
  });

  afterEach(async () => {
    if (prevTendDir === undefined) {
      delete Bun.env["TOOLKIT_TEND_DIR"];
    } else {
      Bun.env["TOOLKIT_TEND_DIR"] = prevTendDir;
    }
    if (tempTendDir !== "") {
      await rm(tempTendDir, { recursive: true, force: true });
    }
  });

  test("writes valid PinchTab lease JSON and deletes it on release", async () => {
    const handle = await createPinchtabLease("ses_123", 10_000);
    const raw = await readFile(handle.filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toMatchObject({
      version: 1,
      id: handle.lease.id,
      kind: "pinchtab",
      target: "ses_123",
      ownerPid: process.pid,
    });
    expect(typeof handle.lease.processStart).toBe("string");
    expect(handle.lease.processStart.length).toBeGreaterThan(0);
    expect(Date.parse(handle.lease.expiresAt)).toBeGreaterThan(
      Date.parse(handle.lease.createdAt),
    );

    await handle.release();
    const remaining = await readdir(nodePath.join(tempTendDir, "leases"));
    expect(remaining).toEqual([]);
  });

  test("tracks leases during captureScreenshot and cleans up tab + leases on success", async () => {
    let observedLeasesDuringShot: string[] = [];
    const { client, events } = makeFakeClient({
      screenshot: async (_token, tabId, outPath) => {
        events.push(`screenshot:${tabId}`);
        observedLeasesDuringShot = await readdir(
          nodePath.join(tempTendDir, "leases"),
        );
        return { success: true, data: outPath };
      },
    });

    const result = await captureScreenshot({
      baseUrl: "http://localhost:4321",
      route: "/",
      outPath: nodePath.join(tempTendDir, "out.png"),
      waitForSelector: "main",
      client,
    });

    expect(result.path).toContain("out.png");
    expect(observedLeasesDuringShot).toHaveLength(2);
    expect(events).toEqual([
      "createSession",
      "navigateNewTab:http://localhost:4321/",
      "screenshot:tab_test_1",
      "closeTab:tab_test_1",
      "revokeSession:ses_test_1",
    ]);

    const remaining = await readdir(nodePath.join(tempTendDir, "leases"));
    expect(remaining).toEqual([]);
  });

  test("opens loopback HTTP blank page (not about:blank) when pre-paint theme/viewport emulation is requested", async () => {
    const { client, events } = makeFakeClient();

    await captureScreenshot({
      baseUrl: "http://localhost:4321",
      route: "/",
      outPath: nodePath.join(tempTendDir, "themed.png"),
      theme: "dark",
      viewport: { width: 1280, height: 800 },
      waitForSelector: "main",
      client,
    });

    expect(events[0]).toBe("createSession");
    expect(events[1]).toMatch(/^navigateNewTab:http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(events.slice(2)).toEqual([
      "navigateTab:tab_test_1:http://localhost:4321/",
      "screenshot:tab_test_1",
      "closeTab:tab_test_1",
      "revokeSession:ses_test_1",
    ]);
  });

  test("closes opened PinchTab tab and removes leases in finally when capture fails", async () => {
    const { client, events } = makeFakeClient({
      screenshot: () =>
        Promise.resolve({ success: false, error: "renderer crashed" }),
    });

    await expect(
      captureScreenshot({
        baseUrl: "http://localhost:4321",
        route: "/",
        outPath: nodePath.join(tempTendDir, "out.png"),
        waitForSelector: "main",
        client,
      }),
    ).rejects.toThrow("renderer crashed");

    expect(events).toEqual([
      "createSession",
      "navigateNewTab:http://localhost:4321/",
      "closeTab:tab_test_1",
      "revokeSession:ses_test_1",
    ]);

    const remaining = await readdir(nodePath.join(tempTendDir, "leases"));
    expect(remaining).toEqual([]);
  });
});

describe("PinchTab direct HTTP REST client", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  test("resolves port and token across PINCHTAB_CONFIG, macOS Library config, ~/.pinchtab/config.json, PINCHTAB_SERVER, and PINCHTAB_TOKEN", async () => {
    const homeDir = await mkdtemp(nodePath.join(os.tmpdir(), "pt-home-"));
    tempDirs.push(homeDir);

    const dotDir = nodePath.join(homeDir, ".pinchtab");
    await mkdir(dotDir, { recursive: true });
    await writeFile(
      nodePath.join(dotDir, "config.json"),
      JSON.stringify({ server: { port: "9901", token: "dot-token" } }),
    );
    expect(await resolvePinchtabConnection({ env: {}, homeDir })).toEqual({
      baseUrl: "http://127.0.0.1:9901",
      token: "dot-token",
    });

    const libDir = nodePath.join(
      homeDir,
      "Library",
      "Application Support",
      "pinchtab",
    );
    await mkdir(libDir, { recursive: true });
    await writeFile(
      nodePath.join(libDir, "config.json"),
      JSON.stringify({ server: { port: "9902", token: "lib-token" } }),
    );
    expect(await resolvePinchtabConnection({ env: {}, homeDir })).toEqual({
      baseUrl: "http://127.0.0.1:9902",
      token: "lib-token",
    });

    const explicitCfg = nodePath.join(homeDir, "explicit.json");
    await writeFile(
      explicitCfg,
      JSON.stringify({ server: { port: "9903", token: "explicit-token" } }),
    );
    expect(
      await resolvePinchtabConnection({
        env: {
          PINCHTAB_CONFIG: explicitCfg,
          PINCHTAB_SERVER: "http://127.0.0.1:9999/",
          PINCHTAB_TOKEN: "env-override-token",
          PINCHTAB_SESSION: "foreign-session-must-be-ignored",
        },
        homeDir,
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:9999",
      token: "env-override-token",
    });
  });

  test("drives full captureScreenshot lifecycle over HTTP REST without spawning pinchtab CLI", async () => {
    const dir = await mkdtemp(nodePath.join(os.tmpdir(), "pt-http-"));
    tempDirs.push(dir);
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const recorded: {
      method: string;
      url: string;
      auth: string;
      body: string;
    }[] = [];

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const reqUrl = req.url ?? "/";
        recorded.push({
          method: req.method ?? "GET",
          url: reqUrl,
          auth: req.headers.authorization ?? "",
          body,
        });
        if (reqUrl === "/health") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        if (reqUrl === "/sessions" && req.method === "POST") {
          res.writeHead(201, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "ses_http_1",
              agentId: "toolkit-screenshot",
              sessionToken: "stok_http_1",
              status: "active",
            }),
          );
          return;
        }
        if (reqUrl === "/sessions/ses_http_1" && req.method === "DELETE") {
          // Simulate PinchTab 0.15.2 returning 405 on DELETE so fallback to /revoke is exercised too.
          res.writeHead(405);
          res.end("Method Not Allowed");
          return;
        }
        if (reqUrl === "/sessions/ses_http_1/revoke" && req.method === "POST") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        if (reqUrl === "/navigate" && req.method === "POST") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ tabId: "tab_http_1" }));
          return;
        }
        if (reqUrl.startsWith("/tabs/tab_http_1/count")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ selector: "main", count: 1 }));
          return;
        }
        if (reqUrl === "/tabs/tab_http_1/url") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ url: "http://localhost:4321/" }));
          return;
        }
        if (reqUrl.startsWith("/tabs/tab_http_1/screenshot")) {
          res.writeHead(200, { "content-type": "image/png" });
          res.end(pngBytes);
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const addr = server.address();
      const port = addr !== null && typeof addr === "object" ? addr.port : 0;
      const opts = {
        env: {
          PINCHTAB_SERVER: `http://127.0.0.1:${String(port)}`,
          PINCHTAB_TOKEN: "admin_tok_1",
          PATH: "",
        },
        homeDir: dir,
      };

      const httpClient = createPinchtabHttpClient(opts);
      const healthRes = await httpClient.health();
      expect(healthRes.success).toBe(true);

      const outPath = nodePath.join(dir, "shot.png");
      await captureScreenshot({
        baseUrl: "http://localhost:4321",
        route: "/",
        outPath,
        theme: "dark",
        viewport: { width: 1280, height: 720 },
        fullPage: true,
        waitForSelector: "main",
        client: httpClient,
      });

      const written = new Uint8Array(await readFile(outPath));
      expect([...written]).toEqual([...pngBytes]);
      expect(recorded.map((r) => `${r.method} ${r.url}`)).toEqual([
        "GET /health",
        "POST /sessions",
        "POST /navigate",
        "POST /tabs/tab_http_1/emulation/viewport",
        "POST /tabs/tab_http_1/emulation/media",
        "POST /tabs/tab_http_1/navigate",
        "GET /tabs/tab_http_1/count?selector=main",
        "GET /tabs/tab_http_1/screenshot?format=png&raw=true&beyondViewport=true",
        "POST /tabs/tab_http_1/close",
        "DELETE /sessions/ses_http_1",
        "POST /sessions/ses_http_1/revoke",
      ]);
      expect(recorded[1]?.auth).toBe("Bearer admin_tok_1");
      expect(recorded[2]?.auth).toBe("Bearer stok_http_1");
      expect(recorded.at(-1)?.auth).toBe("Bearer admin_tok_1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
