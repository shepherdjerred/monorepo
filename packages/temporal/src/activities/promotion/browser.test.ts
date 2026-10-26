import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { PromotionBrowser } from "./browser.ts";
import { captchaApplicationScript } from "./browser-scripts.ts";
import { promotionTarget } from "./manifest.ts";

describe("native PinchTab transport", () => {
  it("keeps compact scanned observations and sends actual input refs over HTTP", async () => {
    const target = promotionTarget("pmc");
    const paths: string[] = [],
      actions: unknown[] = [];
    let failSnapshot = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        paths.push(url.pathname + url.search);
        if (url.pathname === "/profiles")
          return Response.json([{ name: "storm-promotion-pmc" }]);
        if (url.pathname === "/instances")
          return Response.json([
            { id: "owned", profileName: "storm-promotion-pmc" },
          ]);
        if (url.pathname === "/instances/owned/tabs") return Response.json([]);
        if (url.pathname.endsWith("/tabs/open"))
          return Response.json({ tabId: "page" });
        if (url.pathname.endsWith("/evaluate")) {
          const { expression } = z
            .object({ expression: z.string() })
            .parse(await request.json());
          return Response.json({
            result: expression === "location.href" ? target.url : [],
          });
        }
        if (url.pathname.endsWith("/snapshot")) {
          if (failSnapshot)
            return new Response("Snapshot unavailable", { status: 503 });
          return Response.json({
            idpiNotice: "UNTRUSTED CONTENT",
            untrustedContent: true,
            nodes: [
              { ref: "e36", role: "textbox", name: "Email or username" },
              {
                ref: "e41",
                role: "textbox",
                name: "Password",
                value: "must-not-enter-observations",
              },
              { ref: "e42", role: "text", name: "Bump once every 24 hours" },
            ],
          });
        }
        if (url.pathname.endsWith("/attr"))
          return Response.json({ value: "password" });
        if (url.pathname.endsWith("/action")) {
          const body = z
            .strictObject({
              kind: z.literal("fill"),
              ref: z.string(),
              text: z.string(),
            })
            .parse(await request.json());
          actions.push(body);
          return Response.json({ success: true });
        }
        return new Response("Unknown test route", { status: 404 });
      },
    });
    try {
      const browser = new PromotionBrowser(
        target,
        server.url.origin,
        "fixture-browser-token",
        { signal: new AbortController().signal },
      );
      await browser.open(target.url);
      const page = await browser.snapshot();
      expect(page.text).toContain("UNTRUSTED CONTENT");
      expect(page.text).toContain("Bump once every 24 hours");
      expect(paths).toContain("/tabs/page/snapshot?format=json");
      expect(page.text).not.toContain("must-not-enter-observations");
      expect(await browser.accessibleControl("e41")).toMatchObject({
        role: "textbox",
      });
      expect(await browser.attribute("e41", "type")).toBe("password");
      expect(paths.filter((path) => path.includes("/snapshot"))).toHaveLength(
        1,
      );
      await browser.snapshot({ selector: "main" });
      expect(paths).toContain("/tabs/page/snapshot?format=json&selector=main");
      await browser.action({
        kind: "fill",
        ref: "e41",
        text: "fixture-password",
      });
      expect(actions).toEqual([
        { kind: "fill", ref: "e41", text: "fixture-password" },
      ]);
      expect(paths).toContain("/tabs/page/attr?selector=e41&name=type");
      await browser.snapshot({ selector: "main", depth: 3 });
      expect(paths).toContain(
        "/tabs/page/snapshot?format=json&selector=main&depth=3",
      );
      failSnapshot = true;
      await expect(browser.snapshot()).rejects.toThrow("Snapshot unavailable");
      await expect(browser.accessibleControl("e41")).rejects.toThrow("Refresh");
      await expect(browser.open("https://outside.invalid/")).rejects.toThrow(
        "scope",
      );
    } finally {
      await server.stop(true);
    }
  });
  it("applies a solver token without a callback that could submit the form", () => {
    const field = { value: "" },
      callback = vi.fn();
    const token = 'fixture"; callback(); //';
    runInNewContext(captchaApplicationScript(token), {
      document: { querySelectorAll: () => [field] },
      callback,
    });
    expect(field.value).toBe(token);
    expect(callback).not.toHaveBeenCalled();
  });
});
