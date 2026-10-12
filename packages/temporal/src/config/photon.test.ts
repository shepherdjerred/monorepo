import { beforeEach, describe, expect, test, vi } from "vitest";
const flag = vi.hoisted(() => vi.fn());
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: () => ({ name: "flag", get: flag }),
}));
import { photonIngressConfig } from "./photon.ts";
beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
});
describe("Photon admission configuration", () => {
  test("absence safely defaults off without permitted senders", async () => {
    expect(await photonIngressConfig()).toEqual({
      sourceAvailable: true,
      enabled: false,
      owners: [],
    });
  });
  test("explicit false remains authoritative", async () => {
    flag.mockImplementation((names: { key: string }) =>
      Promise.resolve({ value: names.key !== "enabled" && "+15550000001" }),
    );
    expect(await photonIngressConfig()).toEqual({
      sourceAvailable: true,
      enabled: false,
      owners: ["+15550000001"],
    });
  });
  test("invalid present values fail validation", async () => {
    flag.mockResolvedValue({ value: "not-a-boolean" });
    await expect(photonIngressConfig()).rejects.toThrow();
  });
  test("source failures are reported as unavailable", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {
      /* Intentional source-outage observation without test diagnostics. */
    });
    try {
      flag.mockRejectedValue(new Error("unavailable"));
      expect(await photonIngressConfig()).toEqual({
        sourceAvailable: false,
        enabled: false,
        owners: [],
      });
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
});
