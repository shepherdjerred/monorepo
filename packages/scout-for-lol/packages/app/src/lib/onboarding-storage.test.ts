import { describe, expect, test } from "vitest";
import { shouldRedirectToOnboarding } from "#src/lib/onboarding-storage.ts";

describe("shouldRedirectToOnboarding", () => {
  test("always redirects users without a manageable server", () => {
    expect(shouldRedirectToOnboarding(false, false)).toBe(true);
    expect(shouldRedirectToOnboarding(false, true)).toBe(true);
  });

  test("redirects incomplete users who have a manageable server", () => {
    expect(shouldRedirectToOnboarding(true, false)).toBe(true);
  });

  test("lets completed users with a manageable server use the picker", () => {
    expect(shouldRedirectToOnboarding(true, true)).toBe(false);
  });
});
