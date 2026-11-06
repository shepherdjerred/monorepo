import { expect, it } from "vitest";
import { z } from "zod/v4";
import { PromotionBrowser } from "#activities/promotion/browser.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { installChallengeCapture, readChallenge } from "./challenge-scripts.ts";

it("initializes CAPTCHA state again after a native same-URL reload", async () => {
  const target = promotionTarget("pmc");
  let captured = false;
  let generation = 1;
  function evaluate(expression: string): Response {
    if (expression === "location.href")
      return Response.json({ result: target.url });
    if (expression === installChallengeCapture) {
      captured = true;
      return Response.json({ result: true });
    }
    if (expression === readChallenge)
      return Response.json({
        result: { type: "RecaptchaV2TaskProxyless", websiteKey: "fixture" },
      });
    if (expression === "window.__stormCaptchaCapture.documentId")
      return captured
        ? Response.json({ result: "document-" + String(generation) })
        : new Response("Missing CAPTCHA context", { status: 500 });
    return new Response("Unexpected expression", { status: 500 });
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/profiles")
        return Response.json([{ name: "storm-promotion-pmc" }]);
      if (path === "/instances")
        return Response.json([
          { id: "owned", profileName: "storm-promotion-pmc" },
        ]);
      if (path === "/instances/owned/tabs") return Response.json([]);
      if (path.endsWith("/tabs/open")) return Response.json({ tabId: "page" });
      if (path.endsWith("/action")) {
        captured = false;
        generation++;
        return Response.json({ success: true });
      }
      if (path.endsWith("/evaluate")) {
        const { expression } = z
          .object({ expression: z.string() })
          .parse(await request.json());
        return evaluate(expression);
      }
      return new Response("Unexpected route", { status: 500 });
    },
  });
  try {
    const browser = new PromotionBrowser(target, server.url.origin, "fixture", {
      signal: new AbortController().signal,
    });
    await browser.open(target.url);
    const before = await browser.challengeContext();
    expect(before.documentId).toBe("document-1");
    await browser.followLink({ kind: "click", ref: "e1" }, target.url);
    const after = await browser.challengeContext();
    expect(after.documentId).toBe("document-2");
  } finally {
    await server.stop(true);
  }
});
