import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import {
  captchaResponsePresent,
  captchaChallengePresent,
} from "#activities/promotion/browser-scripts.ts";
import { harness } from "#activities/promotion/tool-test-support.ts";

it.each([
  { captured: null, widget: null, expected: false },
  { captured: null, widget: {}, expected: true },
  {
    captured: { type: "TurnstileTaskProxyless" },
    widget: null,
    expected: true,
  },
])(
  "detects an actual supported CAPTCHA before authentication: %j",
  ({ captured, widget, expected }) => {
    expect(
      runInNewContext(captchaChallengePresent, {
        window: { __stormCaptchaCapture: { challenge: captured } },
        document: { querySelector: () => widget },
      }),
    ).toBe(expected);
  },
);

it.each([
  { values: ["native-response"], ready: true },
  { values: [""], ready: false },
  { values: [], ready: false },
  { values: ["native-response", ""], ready: false },
])(
  "checks response presence without exposing response values: %j",
  ({ values, ready }) => {
    const document = {
      querySelectorAll: () => values.map((value) => ({ value })),
    };
    expect(runInNewContext(captchaResponsePresent, { document })).toBe(ready);
  },
);

it("does not discover or buy a duplicate solve when a response is already staged", async () => {
  const test = await harness();
  vi.spyOn(test.browser, "hasCaptchaResponse").mockResolvedValue(true);
  const discover = vi.spyOn(test.browser, "challengeContext");
  expect(await test.handle({ endpoint: "solve-captcha" })).toEqual({
    alreadyStaged: true,
    responseStaged: true,
    paidSolverTaskCreated: false,
    formSubmitted: false,
    siteAccepted: false,
  });
  expect(discover).not.toHaveBeenCalled();
});
