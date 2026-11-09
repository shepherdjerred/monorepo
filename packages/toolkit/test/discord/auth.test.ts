import { describe, expect, it, vi } from "vitest";
import {
  discordPasswordToken,
  discordDaemonEnvironment,
} from "#lib/discord/auth.ts";
import { requiredCredentialsFor } from "#lib/credential-commands.ts";
import path from "node:path";

describe("isolated Discord credential login", () => {
  it("reaches CLI argument validation when password login has no token requirements", async () => {
    // Invalid TTL stops before daemon startup or a network login. An empty
    // credential resolver would fail earlier and never reach this diagnostic.
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(import.meta.dir, "../../src/index.ts"),
        "discord",
        "daemon",
        "start",
        "--password-login",
        "--ttl",
        "invalid",
      ],
      {
        env: {
          PATH: Bun.env["PATH"],
          DISCORD_USER_EMAIL: "fixture@example.invalid",
          DISCORD_USER_PASSWORD: "fixture-only",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(1);
    expect(stdout + stderr).toMatch(/invalid.*ttl|ttl.*invalid/i);
  });
  it("completes one enrolled TOTP challenge without replaying password login", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          mfa: true,
          ticket: "fixture-ticket",
          login_instance_id: "fixture-login-instance",
        }),
      )
      .mockResolvedValueOnce(Response.json({ token: "fixture-session" }));
    expect(
      await discordPasswordToken(
        "fixture@example.invalid",
        "fixture-password",
        request,
        "123456",
      ),
    ).toBe("fixture-session");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      "https://discord.com/api/v9/auth/mfa/totp",
      expect.objectContaining({
        body: JSON.stringify({
          code: "123456",
          ticket: "fixture-ticket",
          login_instance_id: "fixture-login-instance",
          gift_code_sku_id: null,
          login_source: null,
        }),
      }),
    );
  });
  it("does not expose or retry a rejected TOTP challenge", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ mfa: true, ticket: "fixture-ticket" }),
      )
      .mockResolvedValueOnce(
        Response.json({ message: "invalid" }, { status: 400 }),
      );
    await expect(
      discordPasswordToken(
        "fixture@example.invalid",
        "fixture-password",
        request,
        "123456",
      ),
    ).rejects.toThrow("no session was created");
    expect(request).toHaveBeenCalledTimes(2);
  });
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
