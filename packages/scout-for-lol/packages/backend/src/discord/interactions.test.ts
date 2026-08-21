import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  routeButton,
  type RoutableButtonInteraction,
} from "#src/discord/interactions.ts";
import { formatBucksCustomId } from "#src/betting/custom-id.ts";
import { formatBucksAskPublishCustomId } from "#src/betting/ask-custom-id.ts";
import { resetBucksAskPublishClaimsForTests } from "#src/betting/ask-publish.ts";
import { formatBucksNavigationId } from "#src/betting/navigation.ts";
import { formatParlayCustomId } from "#src/betting/parlay-custom-id.ts";
import { formatPeekPassCustomId } from "#src/betting/peek-pass-custom-id.ts";
import { discordComponentsTotal } from "#src/metrics/index.ts";

const USER_ID = DiscordAccountIdSchema.parse("160509172704739328");
const GUILD_ID = DiscordGuildIdSchema.parse("1337623164146155593");

/**
 * A stand-in for discord.js's ButtonInteraction, built the same way
 * `bet-button.integration.test.ts` builds one: the router's parameter type is
 * structural, so a plain object needs no cast and no mock framework.
 */
function fakeInteraction(
  customId: string,
  guildId: string | null = null,
  options: {
    failPublicSend?: boolean;
    failConfirmationEdit?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let editReplyCount = 0;
  const interaction: RoutableButtonInteraction = {
    customId,
    guildId,
    user: { id: USER_ID, username: "tester" },
    client: { user: { id: "1311755320745394317" } },
    message: {
      id: "message-1",
      author: { id: "1311755320745394317" },
      embeds: [{ toJSON: () => ({ description: "answer" }) }],
    },
    deferred: false,
    replied: false,
    deferUpdate: vi.fn(() => {
      calls.push("deferUpdate");
      return Promise.resolve(undefined);
    }),
    deferReply: vi.fn(() => {
      calls.push("deferReply");
      return Promise.resolve(undefined);
    }),
    reply: vi.fn(() => {
      calls.push("reply");
      return Promise.resolve(undefined);
    }),
    editReply: vi.fn(() => {
      calls.push("editReply");
      editReplyCount += 1;
      if (editReplyCount === 1 && options.failConfirmationEdit === true) {
        return Promise.reject(new Error("confirmation edit failed"));
      }
      return Promise.resolve(undefined);
    }),
    followUp: vi.fn(() => {
      calls.push("followUp");
      return Promise.resolve({ delete: () => Promise.resolve(undefined) });
    }),
    sendPublic: vi.fn(() => {
      calls.push("sendPublic");
      return options.failPublicSend
        ? Promise.reject(new Error("missing send permission"))
        : Promise.resolve(undefined);
    }),
  };
  return { interaction, calls };
}

afterEach(() => {
  resetBucksAskPublishClaimsForTests();
});

describe("routeButton", () => {
  test("leaves another feature's component entirely alone", async () => {
    const { interaction, calls } = fakeInteraction("someoneelse:1:thing");
    await routeButton(interaction);
    // Discord shows the clicker nothing for a component no handler claims, so
    // silence here is the correct answer rather than a missing acknowledgement.
    expect(calls).toEqual([]);
  });

  // `isBucksCustomId` is a prefix check, so the router has already claimed
  // these. Returning without acknowledging left the clicker looking at
  // Discord's red "This interaction failed" — and the router counted it as a
  // successful `bb` handling.
  test.each([
    ["bb:1:b:NA1_1:0:W", "too few segments — an older encoding"],
    ["bb:2:b:NA1_1:0:W:10", "a version this build does not speak"],
    ["bb:1:z:NA1_1:0:W:10", "an action outside the schema"],
    ["bb:1:b:NA1_1:99:W:10", "a roster index outside the frozen snapshot"],
    ["bb:", "the bare namespace"],
  ])("acknowledges a claimed but unparseable ID (%s)", async (customId) => {
    const { interaction, calls } = fakeInteraction(customId);
    await routeButton(interaction);
    expect(calls).toEqual(["deferUpdate"]);
  });

  test.each([
    "bbnav:",
    "bbnav:2:h:160509172704739328:42:0",
    "bbnav:1:x:160509172704739328:42:0",
    "bbnav:1:h:not-a-user:42:0",
    "bbnav:1:h:160509172704739328:0:0",
    "bbnav:1:h:160509172704739328:42:-1",
  ])("acknowledges malformed navigation ID %s", async (customId) => {
    const { interaction, calls } = fakeInteraction(customId);
    await routeButton(interaction);
    expect(calls).toEqual(["deferUpdate"]);
  });

  test("a well-formed ID is not short-circuited as malformed", async () => {
    const { interaction, calls } = fakeInteraction(
      formatBucksCustomId({
        action: "b",
        matchId: "NA1_5000000042",
        subjectIndex: 0,
        side: "W",
        amount: 10,
      }),
    );
    await routeButton(interaction);
    // Reached the handler rather than being short-circuited: a null `guildId`
    // takes its no-server branch, which defers a real reply and answers — no
    // database, and no `deferUpdate`. What the handler decides for a click
    // inside a guild is `bet-button.integration.test.ts`'s subject.
    expect(calls).toEqual(["deferReply", "editReply"]);
  });

  test("routes a well-formed navigation ID separately from bet buttons", async () => {
    const { interaction, calls } = fakeInteraction(
      formatBucksNavigationId({
        action: "h",
        ownerId: USER_ID,
        snapshotId: 42,
        page: 1,
      }),
    );
    await routeButton(interaction);
    expect(calls).toEqual(["deferReply", "editReply"]);
  });

  test.each([
    "bbpass:",
    "bbpass:2:b:160509172704739328:1337623164146155593:42:5",
    "bbpass:1:x:160509172704739328:1337623164146155593:42:5",
    "bbpass:1:b:not-a-user:1337623164146155593:42:5",
  ])("acknowledges malformed peek-pass ID %s", async (customId) => {
    const { interaction, calls } = fakeInteraction(customId);
    await routeButton(interaction);
    expect(calls).toEqual(["deferUpdate"]);
  });

  test("routes a caller-bound peek-pass confirmation separately", async () => {
    const { interaction, calls } = fakeInteraction(
      formatPeekPassCustomId({
        action: "b",
        ownerId: USER_ID,
        serverId: GUILD_ID,
        quotedAtMs: 42,
        quotedPrice: 5,
      }),
    );
    await routeButton(interaction);
    expect(calls).toEqual(["deferReply", "editReply"]);
  });

  test("acknowledges malformed bbask IDs and routes valid publish IDs", async () => {
    const malformed = fakeInteraction("bbask:1:p:not-a-user");
    await routeButton(malformed.interaction);
    expect(malformed.calls).toEqual(["deferUpdate"]);

    const valid = fakeInteraction(
      formatBucksAskPublishCustomId({ askerDiscordId: USER_ID }),
    );
    await routeButton(valid.interaction);
    expect(valid.calls).toEqual(["deferUpdate", "sendPublic", "editReply"]);
  });

  test("records a handled Bryan Bucks publish failure as an error", async () => {
    const customId = formatBucksAskPublishCustomId({
      askerDiscordId: USER_ID,
    });
    const failed = fakeInteraction(customId, null, { failPublicSend: true });
    const errorsBefore = await componentCount("error");
    const successesBefore = await componentCount("success");

    await routeButton(failed.interaction);

    expect(failed.calls).toEqual(["deferUpdate", "sendPublic", "followUp"]);
    expect(await componentCount("error")).toBe(errorsBefore + 1);
    expect(await componentCount("success")).toBe(successesBefore);
  });

  test("records a completed public send as success when its confirmation edit fails", async () => {
    const customId = formatBucksAskPublishCustomId({
      askerDiscordId: USER_ID,
    });
    const published = fakeInteraction(customId, null, {
      failConfirmationEdit: true,
    });
    const errorsBefore = await componentCount("error");
    const successesBefore = await componentCount("success");

    await routeButton(published.interaction);

    expect(published.calls).toEqual(["deferUpdate", "sendPublic", "editReply"]);
    expect(await componentCount("success")).toBe(successesBefore + 1);
    expect(await componentCount("error")).toBe(errorsBefore);
  });

  test("acknowledges a malformed Scout component with a private explanation", async () => {
    const { interaction, calls } = fakeInteraction("scout:1:publish:broken");
    await routeButton(interaction);
    expect(calls).toEqual(["deferUpdate", "followUp"]);
  });

  test("acknowledges malformed parlay IDs and routes valid ones", async () => {
    const malformed = fakeInteraction("bbp:2:b:NA1_1:Y:5");
    await routeButton(malformed.interaction);
    expect(malformed.calls).toEqual(["deferUpdate"]);

    const valid = fakeInteraction(
      formatParlayCustomId({
        action: "b",
        matchId: "NA1_5000000042",
        side: "YES",
        amount: 5,
      }),
    );
    await routeButton(valid.interaction);
    expect(valid.calls).toEqual(["deferReply", "editReply"]);
  });
});

async function componentCount(status: string): Promise<number> {
  const metric = await discordComponentsTotal.get();
  return (
    metric.values.find(
      (value) =>
        value.labels.namespace === "bbask" && value.labels.status === status,
    )?.value ?? 0
  );
}
