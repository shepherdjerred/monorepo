import { beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => vi.fn());
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: () => ({ name: "flag", get: flag }),
}));
import { alertEmailConfig } from "#infrastructure/digest-flag";

beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
});

describe("dashboard mail configuration", () => {
  it("preserves disabled incident mail and existing routing on absence", async () => {
    expect(await alertEmailConfig()).toEqual({
      EMAIL_ENABLED: "false",
      POSTAL_FROM: "alerts@sjer.red",
      POSTAL_TO: "dependencies@sjer.red",
    });
  });

  it("uses false and routing answers without falling through", async () => {
    flag.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({
        value:
          key !== "alertEmailEnabled" &&
          (key === "alertEmailFrom"
            ? "sender@example.test"
            : "recipient@example.test"),
      }),
    );
    expect(await alertEmailConfig()).toEqual({
      EMAIL_ENABLED: "false",
      POSTAL_FROM: "sender@example.test",
      POSTAL_TO: "recipient@example.test",
    });
  });

  it("rejects malformed answers", async () => {
    flag.mockResolvedValue({ value: "not-valid" });
    await expect(alertEmailConfig()).rejects.toThrow();
  });

  it("observes an outage and preserves defaults", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // Assert source-error observation without writing expected warnings.
    });
    flag.mockRejectedValue(new Error("unavailable"));
    try {
      const config = await alertEmailConfig();
      expect(config.EMAIL_ENABLED).toBe("false");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
