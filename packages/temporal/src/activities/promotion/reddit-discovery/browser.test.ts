import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { PromotionBrowser } from "#activities/promotion/browser.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { redditListingScript } from "./browser-scripts.ts";
import { installChallengeCapture } from "#activities/promotion/access/challenge-scripts.ts";

describe("scanned Reddit discovery reader", () => {
  it("scans before metadata extraction and stops when the scan is blocked", async () => {
    const target = promotionTarget("reddit-minecraftserver");
    let currentUrl = "https://old.reddit.com/r/MinecraftServer/new/";
    let blocked = false;
    let extracted = 0;
    const routes: string[] = [];
    const evaluations: string[] = [];
    const listing = [
      {
        id: "abc123",
        subreddit: "MinecraftServer",
        url: "https://www.reddit.com/r/MinecraftServer/comments/abc123/a_title/",
        author: "reader",
        title: "Looking for an SMP",
        createdAt: "2026-11-15T17:00:00Z",
      },
    ];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        routes.push(url.pathname);
        if (url.pathname === "/profiles")
          return Response.json([{ name: "storm-promotion-reddit" }]);
        if (url.pathname === "/instances")
          return Response.json([
            { id: "owned", profileName: "storm-promotion-reddit" },
          ]);
        if (url.pathname.endsWith("/tabs")) return Response.json([]);
        if (url.pathname.endsWith("/tabs/open"))
          return Response.json({ tabId: "owned-tab" });
        if (url.pathname.endsWith("/navigate")) {
          currentUrl = z
            .object({ url: z.string() })
            .parse(await request.json()).url;
          return Response.json({ url: currentUrl });
        }
        if (url.pathname.endsWith("/snapshot")) {
          if (blocked)
            return new Response("IDPI content scan blocked", { status: 451 });
          return Response.json({
            nodes: [{ ref: "title", role: "link", name: listing[0]?.title }],
            idpiNotice: "UNTRUSTED CONTENT",
            untrustedContent: true,
          });
        }
        if (url.pathname.endsWith("/evaluate")) {
          const { expression } = z
            .object({ expression: z.string() })
            .parse(await request.json());
          evaluations.push(expression);
          if (expression === "location.href")
            return Response.json({ result: currentUrl });
          if (expression === redditListingScript(25)) {
            extracted++;
            expect(routes.slice(0, -1)).toContain("/tabs/owned-tab/snapshot");
            return Response.json({ result: listing });
          }
          return Response.json({
            result: expression.includes("const parts=location.pathname")
              ? null
              : [],
          });
        }
        return new Response("Unknown route", { status: 404 });
      },
    });
    try {
      const browser = new PromotionBrowser(
        target,
        server.url.origin,
        "test-token",
        {
          signal: new AbortController().signal,
          captureChallenges: false,
        },
      );
      await browser.open(currentUrl);
      expect(
        await browser.readRedditListing({
          subreddit: "MinecraftServer",
          limit: 25,
        }),
      ).toEqual([
        {
          ...listing[0],
          url: "https://www.reddit.com/r/MinecraftServer/comments/abc123/",
        },
      ]);
      expect(extracted).toBe(1);
      expect(evaluations).not.toContain(installChallengeCapture);
      blocked = true;
      await expect(
        browser.readRedditListing({ subreddit: "MinecraftServer", limit: 25 }),
      ).rejects.toThrow("IDPI content scan blocked");
      expect(extracted).toBe(1);
    } finally {
      await server.stop(true);
    }
  });
});
