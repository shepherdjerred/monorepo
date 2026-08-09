import { afterEach, describe, expect, test } from "bun:test";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { buildDiscordInstallUrl } from "#src/lib/discord/install-url.ts";

/**
 * Only the beta Discord application has `/app/installed` registered as a
 * redirect URI; sending it for any other application makes Discord reject the
 * install with `invalid redirect_uri`.
 */
const BETA_APPLICATION_ID = "1311755320745394317";

function withApplicationId(id: string): URL {
  Bun.env["APPLICATION_ID"] = id;
  resetConfigurationForTests();
  return new URL(buildDiscordInstallUrl());
}

afterEach(() => {
  Bun.env["APPLICATION_ID"] = "test";
  resetConfigurationForTests();
});

describe("buildDiscordInstallUrl", () => {
  test("sends the post-install redirect for the beta application", () => {
    const url = withApplicationId(BETA_APPLICATION_ID);
    expect(url.searchParams.get("redirect_uri")).toEndWith("/app/installed");
  });

  test("omits the redirect for any other application", () => {
    const url = withApplicationId("000000000000000000");
    expect(url.searchParams.get("redirect_uri")).toBeNull();
  });

  test("always carries the install scopes and permissions", () => {
    const url = withApplicationId(BETA_APPLICATION_ID);
    expect(url.searchParams.get("scope")).toBe("bot applications.commands");
    expect(url.searchParams.get("permissions")).not.toBeNull();
  });
});
