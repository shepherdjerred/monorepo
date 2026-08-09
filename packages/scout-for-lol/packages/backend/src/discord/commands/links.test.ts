import { afterEach, describe, expect, test } from "bun:test";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { getDocsUrl } from "#src/discord/commands/links.ts";
import { buildDiscordInstallUrl } from "#src/lib/discord/install-url.ts";

const originalOrigin = Bun.env["WEB_APP_ORIGIN"];

afterEach(() => {
  if (originalOrigin === undefined) {
    delete Bun.env["WEB_APP_ORIGIN"];
  } else {
    Bun.env["WEB_APP_ORIGIN"] = originalOrigin;
  }
  resetConfigurationForTests();
});

describe("stage-aware Discord links", () => {
  test("uses the configured beta origin", () => {
    Bun.env["WEB_APP_ORIGIN"] = "https://beta.scout-for-lol.com/";
    resetConfigurationForTests();

    expect(getDocsUrl()).toBe("https://beta.scout-for-lol.com/docs/");
  });

  test("keeps applications.commands in the install URL", () => {
    Bun.env["WEB_APP_ORIGIN"] = "https://scout-for-lol.com";
    resetConfigurationForTests();

    const installUrl = new URL(buildDiscordInstallUrl());
    expect(installUrl.searchParams.get("scope")).toBe(
      "bot applications.commands",
    );
  });
});
