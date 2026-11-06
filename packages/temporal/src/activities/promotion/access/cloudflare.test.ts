import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { PromotionBrowser } from "#activities/promotion/browser.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { harness } from "#activities/promotion/tool-test-support.ts";
import { cloudflareInterstitial } from "./challenge-scripts.ts";

async function browserFixture() {
  const target = promotionTarget("pmc");
  const state = {
    interstitial: true,
    active: true,
    resolved: true,
    handoff: false,
    calls: 0,
    url: target.url,
  };
  const evaluate = (expression: string): unknown => {
    if (expression === "location.href") return state.url;
    if (expression === cloudflareInterstitial) return state.interstitial;
    return expression.includes("document.title") ? state.active : [];
  };
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
      if (path.endsWith("/snapshot"))
        return Response.json({
          nodes: [{ ref: "e1", role: "button", name: "Fixture control" }],
          idpiNotice: "UNTRUSTED",
          untrustedContent: true,
        });
      if (path.endsWith("/evaluate")) {
        const { expression } = z
          .object({ expression: z.string() })
          .parse(await request.json());
        return Response.json({ result: evaluate(expression) });
      }
      if (path.endsWith("/solve/cloudflare")) {
        expect(await request.json()).toEqual({
          maxAttempts: 1,
          timeout: 60_000,
        });
        state.calls++;
        return Response.json({
          solver: "cloudflare",
          solved: state.resolved,
          attempts: 1,
          ...(state.handoff ? { handoff: "paused_handoff" } : {}),
        });
      }
      return new Response("Unknown test route", { status: 404 });
    },
  });
  const browser = new PromotionBrowser(
    target,
    server.url.origin,
    "fixture-token",
    { signal: new AbortController().signal },
  );
  await browser.open(target.url);
  return { browser, state, server };
}

describe("native Cloudflare access solving", () => {
  it("rejects ordinary/login/publication forms before any native solve", () => {
    const context = {
      window: { _cf_chl_opt: {} },
      document: { title: "Just a moment...", querySelector: () => null },
    };
    expect(runInNewContext(cloudflareInterstitial, context)).toBe(true);
    expect(
      runInNewContext(cloudflareInterstitial, {
        ...context,
        document: {
          ...context.document,
          title: "Performing security verification",
        },
      }),
    ).toBe(true);
    expect(
      runInNewContext(cloudflareInterstitial, {
        ...context,
        document: { ...context.document, querySelector: () => ({}) },
      }),
    ).toBe(false);
    expect(
      runInNewContext(cloudflareInterstitial, { ...context, window: {} }),
    ).toBe(false);
    expect(
      runInNewContext(cloudflareInterstitial, {
        ...context,
        document: { ...context.document, title: "Submit a server" },
      }),
    ).toBe(false);
  });

  it("requires scanned evidence, clears refs, and verifies the challenge actually left", async () => {
    const { browser, state, server } = await browserFixture();
    try {
      await expect(browser.solveCloudflare()).rejects.toThrow(
        "scanned snapshot",
      );
      expect(state.calls).toBe(0);
      await browser.snapshot();
      expect(await browser.accessibleControl("e1")).toMatchObject({
        role: "button",
      });
      state.active = false;
      expect(await browser.solveCloudflare()).toMatchObject({
        solved: true,
        handoff: false,
        formSubmitted: false,
      });
      expect(state.calls).toBe(1);
      await expect(browser.accessibleControl("e1")).rejects.toThrow("Refresh");
      await browser.snapshot();
      await expect(browser.solveCloudflare()).rejects.toThrow("already used");
      expect(state.calls).toBe(1);
    } finally {
      await server.stop(true);
    }
  });

  it("rejects ordinary pages, false success, and paused handoffs", async () => {
    const { browser, state, server } = await browserFixture();
    try {
      await browser.snapshot();
      state.interstitial = false;
      await expect(browser.solveCloudflare()).rejects.toThrow(
        "requires a Cloudflare interstitial",
      );
      expect(state.calls).toBe(0);
      state.interstitial = true;
      expect(await browser.solveCloudflare()).toMatchObject({
        solved: false,
        handoff: false,
      });
      state.url += "?second-page=1";
      await browser.snapshot();
      state.handoff = true;
      expect(await browser.solveCloudflare()).toMatchObject({
        solved: false,
        handoff: true,
      });
    } finally {
      await server.stop(true);
    }
  });

  it("allows access solving in preview and prohibits it in reconciliation", async () => {
    const preview = await harness();
    const solve = vi
      .spyOn(preview.browser, "solveCloudflare")
      .mockResolvedValue({
        solver: "cloudflare",
        solved: true,
        attempts: 1,
        handoff: false,
        url: preview.target.url,
        formSubmitted: false,
      });
    expect(
      await preview.handle({ endpoint: "solve-cloudflare" }),
    ).toMatchObject({ solved: true, formSubmitted: false });
    expect(solve).toHaveBeenCalledOnce();
    const readOnly = await harness(false, true);
    const blocked = vi.spyOn(readOnly.browser, "solveCloudflare");
    await expect(
      readOnly.handle({ endpoint: "solve-cloudflare" }),
    ).rejects.toThrow("Reconciliation");
    expect(blocked).not.toHaveBeenCalled();
  });
});
