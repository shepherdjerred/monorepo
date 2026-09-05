import { afterEach, describe, expect, test } from "vitest";
import { dareV2DraftComponents } from "#src/betting/dares/presentation/dare-components-v2.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  getDocsUrl,
  getExploreConversationUrl,
} from "#src/discord/commands/links.ts";
import { exploreActionRow } from "#src/discord/scout/messages.ts";
import { buildDiscordInstallUrl } from "#src/lib/discord/install-url.ts";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

const originalOrigin = Bun.env["WEB_APP_ORIGIN"];
const originalEnvironment = Bun.env["ENVIRONMENT"];

afterEach(() => {
  if (originalOrigin === undefined) {
    delete Bun.env["WEB_APP_ORIGIN"];
  } else {
    Bun.env["WEB_APP_ORIGIN"] = originalOrigin;
  }
  if (originalEnvironment === undefined) {
    delete Bun.env["ENVIRONMENT"];
  } else {
    Bun.env["ENVIRONMENT"] = originalEnvironment;
  }
  resetConfigurationForTests();
});

describe("stage-aware Discord links", () => {
  test("uses the configured beta origin", () => {
    Bun.env["WEB_APP_ORIGIN"] = "https://beta.scout-for-lol.com/";
    resetConfigurationForTests();

    expect(getDocsUrl()).toBe("https://beta.scout-for-lol.com/docs/");
    expect(getExploreConversationUrl("conversation-id")).toBe(
      "https://beta.scout-for-lol.com/app/explore/conversation-id",
    );
  });

  test("keeps Scout and Bryan Bucks conversation buttons slashless", () => {
    Bun.env["WEB_APP_ORIGIN"] = "https://beta.scout-for-lol.com/";
    resetConfigurationForTests();
    const conversationId = "10000000-0000-4000-8000-000000000001";
    const expected = `https://beta.scout-for-lol.com/app/explore/${conversationId}`;

    const scoutButton = JSON.stringify(
      exploreActionRow({
        conversationId,
        assistantMessageId: "10000000-0000-4000-8000-000000000002",
        posted: false,
      }),
    );
    const dareButtons = JSON.stringify(
      dareV2DraftComponents({
        intentId: "10000000-0000-4000-8000-000000000003",
        dareId: 7,
        revision: 2,
        conversationId,
      }),
    );

    expect(scoutButton).toContain(`"url":"${expected}"`);
    expect(dareButtons).toContain(`"url":"${expected}"`);
    expect(scoutButton).not.toContain(`"url":"${expected}/"`);
    expect(dareButtons).not.toContain(`"url":"${expected}/"`);
  });

  test("keeps applications.commands in the install URL", () => {
    Bun.env["WEB_APP_ORIGIN"] = "https://scout-for-lol.com";
    resetConfigurationForTests();

    const installUrl = new URL(buildDiscordInstallUrl());
    expect(installUrl.searchParams.get("scope")).toBe(
      "bot applications.commands identify",
    );
  });

  test("adds voice-management permissions only to the beta install", () => {
    Bun.env["ENVIRONMENT"] = "beta";
    resetConfigurationForTests();
    const beta = new PermissionsBitField(
      BigInt(
        new URL(buildDiscordInstallUrl()).searchParams.get("permissions") ??
          "0",
      ),
    );
    expect(beta.has(PermissionFlagsBits.ManageChannels)).toBe(true);
    expect(beta.has(PermissionFlagsBits.Connect)).toBe(true);
    expect(beta.has(PermissionFlagsBits.MoveMembers)).toBe(true);

    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();
    const prod = new PermissionsBitField(
      BigInt(
        new URL(buildDiscordInstallUrl()).searchParams.get("permissions") ??
          "0",
      ),
    );
    expect(prod.has(PermissionFlagsBits.ManageChannels)).toBe(false);
    expect(prod.has(PermissionFlagsBits.Connect)).toBe(false);
    expect(prod.has(PermissionFlagsBits.MoveMembers)).toBe(false);
  });
});
