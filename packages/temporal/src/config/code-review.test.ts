import { describe, expect, it, vi } from "vitest";
import { managedFlagInventory } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import {
  DEFAULT_CODE_REVIEW_SETTINGS,
  DEFAULT_CODE_REVIEW_SETTINGS_JSON,
} from "#shared/ci/code-review.ts";
import { useMockedFlagSource } from "./flag-source.test-support.ts";

vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: vi.fn(),
}));
import { codeReviewConfig } from "./code-review.ts";

const source = useMockedFlagSource();

describe("code-review dynamic configuration", () => {
  it("defaults enabled to true with 3:1 CodeRabbit/Codex SWRR weights", async () => {
    expect(await codeReviewConfig()).toEqual({
      enabled: true,
      settings: DEFAULT_CODE_REVIEW_SETTINGS,
    });
  });

  it("preserves explicit false kill-switch from Flags", async () => {
    source.get.mockImplementation((names) =>
      Promise.resolve(
        names.flag === "temporal-code-review-enabled"
          ? { value: false }
          : undefined,
      ),
    );
    expect(await codeReviewConfig()).toEqual({
      enabled: false,
      settings: DEFAULT_CODE_REVIEW_SETTINGS,
    });
  });

  it("parses custom valid weights and timeout overrides", async () => {
    source.get.mockImplementation((names) =>
      Promise.resolve(
        names.flag === "temporal-code-review-settings"
          ? {
              value: JSON.stringify({
                weights: {
                  coderabbit: 5,
                  codex: 2,
                  cubic: 1,
                  codeant: 0,
                },
                quotaCooldownSeconds: 1800,
                timeoutCooldownSeconds: 600,
                requestRetrySeconds: 300,
                providerTimeoutSeconds: 1200,
              }),
            }
          : { value: true },
      ),
    );

    expect(await codeReviewConfig()).toEqual({
      enabled: true,
      settings: {
        weights: {
          coderabbit: 5,
          codex: 2,
          cubic: 1,
          codeant: 0,
        },
        quotaCooldownSeconds: 1800,
        timeoutCooldownSeconds: 600,
        requestRetrySeconds: 300,
        providerTimeoutSeconds: 1200,
      },
    });
  });

  it.each([
    "not-valid-json",
    '{"weights":{"unknown-provider":1}}',
    '{"weights":{"coderabbit":-1}}',
    '{"weights":{"coderabbit":1},"quotaCooldownSeconds":0}',
    '{"weights":{"coderabbit":1},"unexpected":true}',
  ])("throws loudly on present invalid settings: %s", async (value) => {
    source.get.mockImplementation((names) =>
      Promise.resolve(
        names.flag === "temporal-code-review-settings" ? { value } : undefined,
      ),
    );
    await expect(codeReviewConfig()).rejects.toThrow();
  });

  it("falls back to defaults while logging when the flag source errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // Suppress expected warning output during outage fallback test.
    });
    source.get.mockRejectedValue(new Error("flags unavailable"));
    try {
      expect(await codeReviewConfig()).toEqual({
        enabled: true,
        settings: DEFAULT_CODE_REVIEW_SETTINGS,
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("aligns defaults with managed-flag-inventory declarations", () => {
    expect(
      managedFlagInventory.flags.find(
        (flag) => flag.key === "temporal-code-review-enabled",
      ),
    ).toMatchObject({
      namespace: "temporal",
      type: "boolean",
      default: true,
    });
    expect(
      managedFlagInventory.flags.find(
        (flag) => flag.key === "temporal-code-review-settings",
      ),
    ).toMatchObject({
      namespace: "temporal",
      type: "variant",
      default: DEFAULT_CODE_REVIEW_SETTINGS_JSON,
    });
  });
});
