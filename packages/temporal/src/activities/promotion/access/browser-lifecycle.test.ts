import { expect, it } from "vitest";
import { PromotionBrowser } from "#activities/promotion/browser.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";

it("retains the owned tab for inspection and cleanup after navigation fails", async () => {
  const target = promotionTarget("pmc");
  const calls: string[] = [];
  let closed = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      calls.push(path);
      if (path === "/profiles")
        return Response.json([{ name: "storm-promotion-pmc" }]);
      if (path === "/instances")
        return Response.json([
          { id: "owned", profileName: "storm-promotion-pmc", mode: "headless" },
        ]);
      if (path === "/instances/owned/tabs")
        return Response.json([
          { id: "other" },
          ...(closed ? [] : [{ id: "page" }]),
        ]);
      if (path.endsWith("/tabs/open")) {
        expect(await request.json()).toEqual({ url: target.url });
        return Response.json({ tabId: "page" });
      }
      if (path === "/tabs/page/navigate")
        return new Response("Navigation timed out", { status: 504 });
      if (path === "/tabs/page/evaluate")
        return Response.json({ result: target.url });
      if (path === "/tabs/page/snapshot")
        return Response.json({
          idpiNotice: "UNTRUSTED",
          untrustedContent: true,
          nodes: [{ ref: "e1", role: "heading", name: "Just a moment..." }],
        });
      if (path === "/tabs/page/close") {
        closed = true;
        return Response.json({ success: true });
      }
      return new Response("Unexpected route", { status: 500 });
    },
  });
  try {
    const browser = new PromotionBrowser(target, server.url.origin, "fixture", {
      signal: new AbortController().signal,
    });
    await browser.open(target.url);
    await expect(browser.open(target.url)).rejects.toThrow(
      "Navigation timed out",
    );
    const page = await browser.snapshot();
    expect(page.text).toContain("Just a moment...");
    await browser.close();
    expect(closed).toBe(true);
    expect(calls.some((path) => path.includes("/tabs/other/"))).toBe(false);
  } finally {
    await server.stop(true);
  }
});

it.each([
  { mode: "headed", otherTab: false, parked: true, closeLag: 0 },
  { mode: "headed", otherTab: true, parked: false, closeLag: 0 },
  { mode: "headless", otherTab: false, parked: false, closeLag: 0 },
  { mode: "headed", otherTab: true, parked: false, closeLag: 2 },
])(
  "keeps a headed profile usable without disturbing other tabs: %j",
  async (options) => {
    const calls: { path: string; body: unknown }[] = [];
    const target = promotionTarget("pmc");
    let closed = false;
    let remainingCloseReads = options.closeLag;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        const body: unknown =
          request.method === "POST" ? await request.json() : null;
        calls.push({ path, body });
        if (path === "/profiles")
          return Response.json([{ name: "storm-promotion-pmc" }]);
        if (path === "/instances")
          return Response.json([
            {
              id: "owned",
              profileName: "storm-promotion-pmc",
              mode: options.mode,
            },
          ]);
        if (path === "/instances/owned/tabs") {
          const taskPresent = !closed || remainingCloseReads-- > 0;
          return Response.json([
            ...(taskPresent ? [{ id: "page" }] : []),
            ...(options.otherTab ? [{ id: "other" }] : []),
          ]);
        }
        if (path.endsWith("/tabs/open"))
          return Response.json({ tabId: "page" });
        if (path.endsWith("/evaluate"))
          return Response.json({ result: target.url });
        if (path.endsWith("/close")) {
          closed = true;
          return Response.json({ success: true });
        }
        return path.endsWith("/navigate")
          ? Response.json({ success: true })
          : new Response("Unexpected route", { status: 500 });
      },
    });
    try {
      const browser = new PromotionBrowser(
        target,
        server.url.origin,
        "fixture",
        { signal: new AbortController().signal },
      );
      await browser.open(target.url);
      await browser.close();
      if (options.parked)
        expect(calls.at(-1)).toEqual({
          path: "/tabs/page/navigate",
          body: { url: target.url },
        });
      else {
        expect(calls).toContainEqual({ path: "/tabs/page/close", body: {} });
        expect(calls.at(-1)?.path).toBe("/instances/owned/tabs");
        expect(remainingCloseReads).toBeLessThan(0);
      }
      expect(calls.some((c) => c.path.includes("/tabs/other/"))).toBe(false);
    } finally {
      await server.stop(true);
    }
  },
);
