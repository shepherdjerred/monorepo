import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  installChallengeCapture,
  readChallenge,
  applyCloudflareChallenge,
} from "./challenge-scripts.ts";

describe("Cloudflare challenge bridge", () => {
  it("captures render parameters and forwards the original render unchanged", () => {
    const render = vi.fn().mockReturnValue("widget-id"),
      callback = vi.fn();
    const context: {
      window: { turnstile?: { render: typeof render } };
      document: { querySelector: () => null };
    } = { window: {}, document: { querySelector: () => null } };
    runInNewContext(installChallengeCapture, context);
    context.window.turnstile = { render };
    const options = {
      sitekey: "fixture-key",
      action: "managed",
      cData: "fixture-data",
      chlPageData: "fixture-page",
      callback,
    };
    const api = context.window.turnstile;
    expect(api.render("#challenge", options)).toBe("widget-id");
    expect(render).toHaveBeenCalledWith("#challenge", options);
    expect(runInNewContext(readChallenge, context)).toEqual({
      type: "TurnstileTaskProxyless",
      websiteKey: "fixture-key",
      action: "managed",
      cData: "fixture-data",
      chlPageData: "fixture-page",
    });
  });
  it("runs a captured interstitial callback once and refuses promotion forms", () => {
    const callback = vi.fn();
    const state = { challenge: { chlPageData: "fixture-page" }, callback };
    const context = {
      window: { __stormCaptchaCapture: state, _cf_chl_opt: {} },
      document: { title: "Just a moment...", querySelector: () => null },
    };
    runInNewContext(applyCloudflareChallenge('fixture";bad()'), context);
    expect(callback).toHaveBeenCalledExactlyOnceWith('fixture";bad()');
    expect(() =>
      runInNewContext(applyCloudflareChallenge("again"), context),
    ).toThrow("unavailable");
    const formContext = {
      ...context,
      window: {
        ...context.window,
        __stormCaptchaCapture: {
          challenge: { chlPageData: "fixture-page" },
          callback,
        },
      },
      document: { title: "Post an ad", querySelector: () => ({}) },
    };
    expect(() =>
      runInNewContext(applyCloudflareChallenge("answer"), formContext),
    ).toThrow("unavailable");
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
