import { OPS_MAILBOXES } from "@shepherdjerred/ops-model/email/mailbox.ts";
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
  it("enables incident mail, quiet-clear digests, and semantic mailbox defaults on absence", async () => {
    expect(await alertEmailConfig()).toEqual({
      EMAIL_ENABLED: "true",
      DAILY_DIGEST_QUIET_CLEAR: "true",
      POSTAL_FROM: OPS_MAILBOXES.alerts.from,
      POSTAL_TO: OPS_MAILBOXES.alerts.to,
      POSTAL_DIGEST_FROM: OPS_MAILBOXES.digests.from,
      POSTAL_DIGEST_TO: OPS_MAILBOXES.digests.to,
    });
  });

  it("uses false and separate incident and digest routing answers without falling through", async () => {
    const answers: Record<string, unknown> = {
      alertEmailEnabled: false,
      dailyDigestQuietClear: false,
      incidentEmailFrom: "Custom Alerts <incident@example.test>",
      incidentEmailTo: "incident@example.test",
      digestEmailFrom: "digest@example.test",
      digestEmailTo: "digest-inbox@example.test",
    };
    flag.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve({ value: answers[key] }),
    );
    expect(await alertEmailConfig()).toEqual({
      EMAIL_ENABLED: "false",
      DAILY_DIGEST_QUIET_CLEAR: "false",
      POSTAL_FROM: "Custom Alerts <incident@example.test>",
      POSTAL_TO: "incident@example.test",
      POSTAL_DIGEST_FROM: "digest@example.test",
      POSTAL_DIGEST_TO: "digest-inbox@example.test",
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
      expect(config).toEqual({
        EMAIL_ENABLED: "true",
        DAILY_DIGEST_QUIET_CLEAR: "true",
        POSTAL_FROM: OPS_MAILBOXES.alerts.from,
        POSTAL_TO: OPS_MAILBOXES.alerts.to,
        POSTAL_DIGEST_FROM: OPS_MAILBOXES.digests.from,
        POSTAL_DIGEST_TO: OPS_MAILBOXES.digests.to,
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
