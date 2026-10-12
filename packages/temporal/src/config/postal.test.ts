import { beforeEach, describe, expect, test, vi } from "vitest";

const flag = vi.hoisted(() => vi.fn());
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: () => ({ name: "flag", get: flag }),
}));
import { postalAddressesConfig } from "./postal.ts";

beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
});

describe("report mail routing", () => {
  test("preserves existing addresses on absence", async () => {
    expect(await postalAddressesConfig()).toEqual({
      recipient: "dependencies@sjer.red",
      sender: "deps@sjer.red",
    });
  });

  test("resolves routing for each delivery", async () => {
    flag.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ value: `${key}@example.test` }),
    );
    expect(await postalAddressesConfig()).toEqual({
      recipient: "recipient@example.test",
      sender: "sender@example.test",
    });
    flag.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ value: `${key}-updated@example.test` }),
    );
    const updated = await postalAddressesConfig();
    expect(updated.recipient).toBe("recipient-updated@example.test");
  });

  test("rejects invalid present addresses", async () => {
    flag.mockResolvedValue({ value: "invalid" });
    await expect(postalAddressesConfig()).rejects.toThrow();
  });

  test("observes outages while preserving routing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // Assert source-error observation without writing expected warnings.
    });
    flag.mockRejectedValue(new Error("unavailable"));
    try {
      const config = await postalAddressesConfig();
      expect(config.sender).toBe("deps@sjer.red");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
