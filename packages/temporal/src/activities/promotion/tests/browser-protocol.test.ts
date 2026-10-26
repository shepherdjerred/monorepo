import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { PromotionBrowser } from "#activities/promotion/browser.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";

const ActionSchema = z.strictObject({
  kind: z.enum(["fill", "click"]),
  selector: z.string(),
  text: z.string().optional(),
});

function evaluation(expression: string, url: string) {
  if (expression === "location.href") return url;
  const password = expression.includes("#password");
  return {
    tag: "input",
    type: password ? "password" : "text",
    href: "",
    label: expression.includes("#login") ? "Log in" : "Bump Submission",
    password,
  };
}

describe("PinchTab action HTTP contract", () => {
  it("fills, signs in and submits using the required kind field", async () => {
    const target = promotionTarget("pmc");
    const actions: z.infer<typeof ActionSchema>[] = [];
    const responses = new Map<string, unknown>([
      ["/profiles", [{ name: "storm-promotion-pmc" }]],
      ["/instances", [{ id: "owned", profileName: "storm-promotion-pmc" }]],
      ["/instances/owned/tabs", []],
      ["/instances/owned/tabs/open", { tabId: "page" }],
    ]);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (responses.has(path)) return Response.json(responses.get(path));
        if (path.endsWith("/evaluate")) {
          const body = z
            .object({ expression: z.string() })
            .parse(await request.json());
          return Response.json({
            result: evaluation(body.expression, target.url),
          });
        }
        if (path.endsWith("/action")) {
          const parsed = ActionSchema.safeParse(await request.json());
          if (!parsed.success)
            return Response.json(
              { error: "missing or invalid action kind" },
              { status: 400 },
            );
          actions.push(parsed.data);
          return Response.json({ success: true });
        }
        return new Response("Unknown test route", { status: 404 });
      },
    });
    try {
      const browser = new PromotionBrowser(
        target,
        server.url.origin,
        "fixture",
        new AbortController().signal,
      );
      await browser.open(target.url);
      await browser.fill("#title", "Prepared fixture copy");
      await browser.login({
        username: "fixture-user",
        password: "fixture-password",
        usernameSelector: "#email",
        passwordSelector: "#password",
        submitSelector: "#login",
      });
      await browser.submit("#bump");
      expect(actions).toEqual([
        { kind: "fill", selector: "#title", text: "Prepared fixture copy" },
        { kind: "fill", selector: "#email", text: "fixture-user" },
        { kind: "fill", selector: "#password", text: "fixture-password" },
        { kind: "click", selector: "#login" },
        { kind: "click", selector: "#bump" },
      ]);
    } finally {
      await server.stop(true);
    }
  });
});
