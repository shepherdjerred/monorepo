import { beforeEach, describe, expect, test, vi } from "vitest";
const flag = vi.hoisted(() => vi.fn());
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: () => ({ name: "flag", get: flag }),
}));
import { imessageChatModels, ImessageOwnersSchema } from "./imessage.ts";
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
    expect(ImessageOwnersSchema.parse("[]")).toEqual([]);
    expect(() => ImessageOwnersSchema.parse("x".repeat(201))).toThrow();
  });
  test("absence resolves the provider model defaults", async () => {
    expect(await imessageChatModels()).toEqual({
      sourceAvailable: true,
      claudeModel: "claude-opus-5",
      codexModel: "gpt-5.6-luna",
    });
  });
  test("new chats resolve each provider's model without reading retired admission flags", async () => {
    flag.mockImplementation((names: { key: string }) =>
      Promise.resolve({ value: `${names.key}-override` }),
    );
    expect(await imessageChatModels()).toEqual({
      sourceAvailable: true,
      claudeModel: "claudeModel-override",
      codexModel: "codexModel-override",
    });
    expect(flag).toHaveBeenCalledTimes(2);
  });
  test("present invalid flags fail instead of silently selecting defaults", async () => {
    flag.mockResolvedValue({ value: "" });
    await expect(imessageChatModels()).rejects.toThrow();
  });
  test("source outages are observed and retain the safe default", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {
      // Assert outage observation without emitting intentional test diagnostics.
    });
    try {
      flag.mockRejectedValue(new Error("source unavailable"));
      expect(await imessageChatModels()).toEqual({
        sourceAvailable: false,
        claudeModel: "claude-opus-5",
        codexModel: "gpt-5.6-luna",
      });
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
});
