import { describe, expect, it, vi } from "vitest";
import {
  discordPasswordToken,
  discordDaemonEnvironment,
} from "#lib/discord/auth.ts";
import { requiredCredentialsFor } from "#lib/credentials.ts";

describe("isolated Discord credential login", () => {
  it("keeps a user-only daemon limited to its enrolled user token", () => {
    expect(
      requiredCredentialsFor("discord", "daemon", {}, [
        "daemon",
        "start",
        "--user-only",
      ]),
    ).toEqual(["DISCORD_USER_TOKEN"]);
    expect(
      discordDaemonEnvironment(
        {
          PATH: "/bin",
          DISCORD_USER_TOKEN: "fixture-user",
          DISCORD_BOT_TOKEN: "fixture-bot",
          OP_SERVICE_ACCOUNT_TOKEN: "fixture-vault",
          OPENAI_API_KEY: "fixture-inference",
        },
        { passwordLogin: false, userOnly: true },
      ),
    ).toEqual({ PATH: "/bin", DISCORD_USER_TOKEN: "fixture-user" });
    expect(() =>
      discordDaemonEnvironment({}, { passwordLogin: true, userOnly: true }),
    ).toThrow("not both");
  });
  it("keeps credentials in the native request and returns the session only to its caller", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ token: "fixture-session" }));
    expect(
      await discordPasswordToken(
        "fixture@example.invalid",
        "fixture-password",
        request,
      ),
    ).toBe("fixture-session");
    expect(request).toHaveBeenCalledWith(
      "https://discord.com/api/v9/auth/login",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"password":"fixture-password"'),
      }),
    );
  });
  it.each([
    { mfa: true, ticket: "private-ticket" },
    { captcha_key: ["challenge"] },
  ])(
    "reports an interactive challenge without replaying it or exposing its data",
    async (body) => {
      const request = vi.fn().mockResolvedValue(Response.json(body));
      await expect(
        discordPasswordToken(
          "fixture@example.invalid",
          "fixture-password",
          request,
        ),
      ).rejects.toThrow("requires interactive verification");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("does not expose credential-bearing native exceptions", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new Error("request with fixture-password"));
    await expect(
      discordPasswordToken(
        "fixture@example.invalid",
        "fixture-password",
        request,
      ),
    ).rejects.not.toThrow("fixture-password");
  });
  it("does not load unrelated account tokens for password login", () => {
    expect(
      requiredCredentialsFor("discord", "daemon", {}, [
        "daemon",
        "start",
        "--password-login",
      ]),
    ).toEqual([]);
  });
});
