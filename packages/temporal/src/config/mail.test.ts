import { beforeEach, describe, expect, test, vi } from "vitest";

const flag = vi.hoisted(() => vi.fn());
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: () => ({ name: "flag", get: flag }),
}));
import { mailAddressesConfig, resolveMailAddressesForReport } from "./mail.ts";

beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
});

describe("report mail routing", () => {
  test("preserves existing addresses on absence", async () => {
    expect(await mailAddressesConfig()).toEqual({
      recipient: "dependencies@sjer.red",
      sender: "deps@sjer.red",
    });
  });

  test("accepts display-name sender mailboxes from flags", async () => {
    flag.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve(
        key === "sender"
          ? { value: "Homelab Audit <ops@sjer.red>" }
          : { value: "ops@sjer.red" },
      ),
    );
    expect(await mailAddressesConfig()).toEqual({
      recipient: "ops@sjer.red",
      sender: "Homelab Audit <ops@sjer.red>",
    });
  });

  test("maps report families to semantic @sjer.red mailboxes by default", async () => {
    await expect(
      resolveMailAddressesForReport("dependency-summary"),
    ).resolves.toEqual({
      recipient: "deps@sjer.red",
      sender: "Repo Dependencies <deps@sjer.red>",
    });
    await expect(
      resolveMailAddressesForReport("homelab-audit"),
    ).resolves.toEqual({
      recipient: "ops@sjer.red",
      sender: "Homelab Audit <ops@sjer.red>",
    });
    await expect(
      resolveMailAddressesForReport("tasknotes-canary"),
    ).resolves.toEqual({
      recipient: "ops@sjer.red",
      sender: "Homelab Audit <ops@sjer.red>",
    });
    await expect(
      resolveMailAddressesForReport("scout-data-dragon"),
    ).resolves.toEqual({
      recipient: "scout@sjer.red",
      sender: "Scout Automation <scout@sjer.red>",
    });
    await expect(
      resolveMailAddressesForReport("main-vuln-scan"),
    ).resolves.toEqual({
      recipient: "reports@sjer.red",
      sender: "Temporal Reports <reports@sjer.red>",
    });
    await expect(resolveMailAddressesForReport("agent-task")).resolves.toEqual({
      recipient: "reports@sjer.red",
      sender: "Temporal Reports <reports@sjer.red>",
    });
  });

  test("honors explicit non-default Flags overrides per field", async () => {
    flag.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve(
        key === "recipient"
          ? { value: "override@sjer.red" }
          : { value: "deps@sjer.red" },
      ),
    );
    await expect(
      resolveMailAddressesForReport("homelab-audit"),
    ).resolves.toEqual({
      recipient: "override@sjer.red",
      sender: "Homelab Audit <ops@sjer.red>",
    });

    flag.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve(
        key === "sender"
          ? { value: "Custom Sender <custom@sjer.red>" }
          : { value: "dependencies@sjer.red" },
      ),
    );
    await expect(
      resolveMailAddressesForReport("scout-lane-priors"),
    ).resolves.toEqual({
      recipient: "scout@sjer.red",
      sender: "Custom Sender <custom@sjer.red>",
    });
  });

  test("resolves routing for each delivery", async () => {
    flag.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ value: `${key}@example.test` }),
    );
    expect(await mailAddressesConfig()).toEqual({
      recipient: "recipient@example.test",
      sender: "sender@example.test",
    });
    flag.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ value: `${key}-updated@example.test` }),
    );
    const updated = await mailAddressesConfig();
    expect(updated.recipient).toBe("recipient-updated@example.test");
  });

  test("rejects invalid present addresses", async () => {
    flag.mockResolvedValue({ value: "invalid" });
    await expect(mailAddressesConfig()).rejects.toThrow();
  });

  test("observes outages while preserving routing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // Assert source-error observation without writing expected warnings.
    });
    flag.mockRejectedValue(new Error("unavailable"));
    try {
      const config = await mailAddressesConfig();
      expect(config.sender).toBe("deps@sjer.red");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
