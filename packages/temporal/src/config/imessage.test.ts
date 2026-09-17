import { beforeEach, describe, expect, test, vi } from "vitest";
const flag = vi.hoisted(() => vi.fn());
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: () => ({ name: "flag", get: flag }),
}));
import { imessageIngressConfig, ImessageOwnersSchema } from "./imessage.ts";
beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
});
describe("iMessage configuration boundaries", () => {
  test("parses bounded exact sender handles and rejects invalid input", () => {
    expect(ImessageOwnersSchema.parse(" owner, second ,")).toEqual([
      "owner",
      "second",
    ]);
    expect(ImessageOwnersSchema.parse("")).toEqual([]);
    expect(() => ImessageOwnersSchema.parse("x".repeat(201))).toThrow();
  });
  test("absence defaults off with no permitted senders", async () => {
    expect(await imessageIngressConfig()).toMatchObject({
      enabled: false,
      owners: [],
    });
  });
  test("explicit false remains authoritative while other flags resolve", async () => {
    flag.mockImplementation((names: { key: string }) =>
      Promise.resolve({
        value:
          names.key === "enabled"
            ? false
            : names.key === "owners"
              ? "owner"
              : "fixed-model",
      }),
    );
    expect(await imessageIngressConfig()).toEqual({
      enabled: false,
      owners: ["owner"],
      claudeModel: "fixed-model",
      codexModel: "fixed-model",
    });
  });
  test("present invalid flags fail instead of silently selecting defaults", async () => {
    flag.mockResolvedValue({ value: "not-a-boolean" });
    await expect(imessageIngressConfig()).rejects.toThrow();
  });
  test("source outages are observed and retain the safe default", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {
      // Assert outage observation without emitting intentional test diagnostics.
    });
    try {
      flag.mockRejectedValue(new Error("source unavailable"));
      expect(await imessageIngressConfig()).toMatchObject({
        enabled: false,
        owners: [],
      });
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
});
