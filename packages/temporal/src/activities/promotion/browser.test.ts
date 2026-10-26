import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPromotionSubmitControl, PromotionBrowser } from "./browser.ts";
import {
  captchaApplicationScript,
  PROMOTION_CONTROLS_SCRIPT,
} from "./browser-scripts.ts";
import { promotionTarget } from "./manifest.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("promotion browser scope", () => {
  it("generates usable root paths without IDs and prefers unique named form controls", () => {
    type ElementFixture = {
      nodeType: number;
      tagName: string;
      id: string;
      parentElement: ElementFixture | null;
      children: ElementFixture[];
      getClientRects: () => number[];
      getAttribute: (name: string) => string | null;
    };
    const element = (
      tagName: string,
      parentElement: ElementFixture | null,
    ): ElementFixture => {
      const result: ElementFixture = {
        nodeType: 1,
        tagName,
        id: "",
        parentElement,
        children: [],
        getClientRects: () => [1],
        getAttribute: () => null,
      };
      parentElement?.children.push(result);
      return result;
    };
    const html = element("HTML", null),
      body = element("BODY", html),
      button = element("BUTTON", body);
    const inspect = (): unknown =>
      runInNewContext(PROMOTION_CONTROLS_SCRIPT, {
        document: { querySelectorAll: () => [button] },
        CSS: { escape: (value: string) => value },
      });
    expect(inspect()).toMatchObject([
      { selector: "html > body:nth-of-type(1) > button:nth-of-type(1)" },
    ]);
    const namedButton = {
      ...button,
      getAttribute: (attribute: string) =>
        attribute === "name" ? "bump" : null,
    };
    const named = runInNewContext(PROMOTION_CONTROLS_SCRIPT, {
      document: { querySelectorAll: () => [namedButton] },
      CSS: { escape: (value: string) => value },
    });
    expect(named).toMatchObject([{ selector: 'button[name="bump"]' }]);
  });
  it("distinguishes owner bumps from votes and unrelated account actions", () => {
    const target = promotionTarget("pmc");
    expect(() =>
      assertPromotionSubmitControl(target, "Bump Submission"),
    ).not.toThrow();
    expect(() =>
      assertPromotionSubmitControl(target, "Vote for this server"),
    ).toThrow("not a promotion");
    expect(() =>
      assertPromotionSubmitControl(target, "Delete listing"),
    ).toThrow("not a promotion");
    expect(() => assertPromotionSubmitControl(target, "Premium bump")).toThrow(
      "not a promotion",
    );
    expect(() => assertPromotionSubmitControl(target, "$5 bump")).toThrow(
      "not a promotion",
    );
    expect(() =>
      assertPromotionSubmitControl(target, "Renew subscription"),
    ).toThrow("not a promotion");
    expect(() => assertPromotionSubmitControl(target, "Save account")).toThrow(
      "explicitly identify",
    );
    expect(() =>
      assertPromotionSubmitControl(
        promotionTarget("reddit-mcservers"),
        "Submit",
      ),
    ).not.toThrow();
  });
  it("reuses the account's running instance and returns sanitized observation data", async () => {
    const paths: string[] = [];
    const target = promotionTarget("pmc");
    const request = vi
      .fn<(url: string, options: RequestInit) => Promise<Response>>()
      .mockImplementation((url, options) => {
        const path = new URL(url).pathname;
        paths.push(path);
        if (path === "/profiles")
          return Promise.resolve(
            Response.json([{ name: "storm-promotion-pmc" }]),
          );
        if (path === "/instances")
          return Promise.resolve(
            Response.json([
              { id: "owned", profileName: "storm-promotion-pmc" },
            ]),
          );
        if (path === "/instances/owned/tabs")
          return Promise.resolve(Response.json([]));
        if (path === "/instances/owned/tabs/open")
          return Promise.resolve(Response.json({ tabId: "page" }));
        if (path.endsWith("/snapshot"))
          return Promise.resolve(
            Response.json({ text: "UNTRUSTED CONTENT: native bump listing" }),
          );
        if (path.endsWith("/evaluate")) {
          if (typeof options.body !== "string")
            throw new TypeError("Expected a JSON browser request");
          const body: unknown = JSON.parse(options.body);
          const expression =
            typeof body === "object" && body !== null && "expression" in body
              ? body.expression
              : "";
          return Promise.resolve(
            Response.json({
              result: expression === "location.href" ? target.url : [],
            }),
          );
        }
        throw new Error(`Unexpected browser request: ${path}`);
      });
    vi.stubGlobal("fetch", request);
    const browser = new PromotionBrowser(
      target,
      "http://browser.invalid",
      "fixture-browser-key",
      new AbortController().signal,
    );
    await browser.open(target.url);
    const observation = await browser.snapshot();
    expect(paths.some((path) => path.endsWith("/start"))).toBe(false);
    expect(observation.text).toContain("UNTRUSTED CONTENT");
    expect(observation.text).not.toContain("fixture-browser-key");
    await expect(browser.open("https://other.example/")).rejects.toThrow(
      "scope",
    );
    await expect(
      browser.open("https://www.planetminecraft.com/bump/123"),
    ).rejects.toThrow("guarded publish");
  });
  it("stages a CAPTCHA token without invoking a callback that could submit early", () => {
    const field = { value: "" };
    const callback = vi.fn();
    const token = 'fixture"; callback(); //';
    runInNewContext(captchaApplicationScript(token), {
      document: { querySelectorAll: () => [field] },
      callback,
    });
    expect(field.value).toBe(token);
    expect(callback).not.toHaveBeenCalled();
  });
});
