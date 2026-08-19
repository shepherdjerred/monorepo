import { afterEach, describe, expect, mock, test } from "bun:test";
import type { APIEmbed } from "discord.js";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import { formatBucksAskPublishCustomId } from "#src/betting/ask-custom-id.ts";
import {
  handleBucksAskPublish,
  resetBucksAskPublishClaimsForTests,
  type BucksAskPublicMessage,
  type BucksAskPublishInteraction,
} from "#src/betting/ask-publish.ts";

const ASKER = bucksTestDiscordId(1);
const BOT_ID = "1311755320745394317";
const EMBED: APIEmbed = {
  title: "Bryan Bucks analysis",
  description: "<@160509172704700001> lost 12 BB across 3 positions.",
  fields: [{ name: "Question", value: "Who lost the most?" }],
};

afterEach(() => {
  resetBucksAskPublishClaimsForTests();
});

describe("Bryan Bucks answer publishing", () => {
  test("posts the exact answer with non-pinging asker attribution", async () => {
    const fake = fakeInteraction();
    await handleBucksAskPublish(fake.interaction);

    expect(fake.publicMessages).toEqual([
      {
        content: `Asked by <@${ASKER}>`,
        embeds: [EMBED],
        allowedMentions: { parse: [] },
        nonce: "ephemeral-answer-1",
        enforceNonce: true,
      },
    ]);
    expect(fake.calls).toEqual(["deferUpdate", "sendPublic", "editReply"]);
    expect(fake.edits[0]?.content).toBe("✅ Posted publicly.");
    expect(fake.edits[0]?.components).toHaveLength(1);
    expect(fake.edits[0]?.components?.[0]?.components[0]).toMatchObject({
      custom_id: formatBucksAskPublishCustomId({ askerDiscordId: ASKER }),
      disabled: true,
    });
  });

  test("refuses a different clicker and a non-bot source message", async () => {
    const wrongUser = fakeInteraction({ userId: bucksTestDiscordId(2) });
    await handleBucksAskPublish(wrongUser.interaction);
    expect(wrongUser.calls).toEqual(["reply"]);
    expect(wrongUser.publicMessages).toEqual([]);

    const forged = fakeInteraction({ authorId: bucksTestDiscordId(3) });
    await handleBucksAskPublish(forged.interaction);
    expect(forged.calls).toEqual(["reply"]);
    expect(forged.publicMessages).toEqual([]);
  });

  test("claims before the first await so rapid clicks post once", async () => {
    let releaseSend: (() => void) | undefined;
    const sendPublic = async (message: BucksAskPublicMessage) => {
      await new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      return message;
    };
    const first = fakeInteraction({ sendPublic });
    const second = fakeInteraction({ sendPublic });

    const firstPublish = handleBucksAskPublish(first.interaction);
    await Bun.sleep(0);
    expect(first.edits).toEqual([]);
    await handleBucksAskPublish(second.interaction);
    expect(second.calls).toEqual(["reply"]);
    expect(second.replies[0]?.content).toContain("already being posted");

    if (releaseSend === undefined) throw new Error("send was not started");
    releaseSend();
    await firstPublish;
    expect(first.publicMessages).toHaveLength(1);
    expect(second.publicMessages).toHaveLength(0);
  });

  test("removes a failed claim so the asker can retry", async () => {
    let attempts = 0;
    const sendPublic = async (message: BucksAskPublicMessage) => {
      attempts++;
      if (attempts === 1) {
        throw Object.assign(new Error("Missing Permissions"), { code: 50_013 });
      }
      return message;
    };
    const first = fakeInteraction({ sendPublic });
    const firstOutcome = await handleBucksAskPublish(first.interaction);
    expect(firstOutcome).toBe("failed");
    expect(first.calls).toEqual(["deferUpdate", "sendPublic", "followUp"]);
    expect(first.edits).toEqual([]);

    const retry = fakeInteraction({ sendPublic });
    const retryOutcome = await handleBucksAskPublish(retry.interaction);
    expect(retryOutcome).toBe("posted");
    expect(retry.calls).toEqual(["deferUpdate", "sendPublic", "editReply"]);
    expect(attempts).toBe(2);
  });

  test("leaves the original retry untouched after a definitive failure", async () => {
    const failed = fakeInteraction({ sendPublic: rejectMissingPermissions });

    const outcome = await handleBucksAskPublish(failed.interaction);

    expect(outcome).toBe("failed");
    expect(failed.calls).toEqual(["deferUpdate", "sendPublic", "followUp"]);
    expect(failed.edits).toEqual([]);
    expect(failed.replies[0]).toMatchObject({
      content: expect.stringContaining("try again"),
    });
  });

  test("keeps a successful post claimed when disabling its button fails", async () => {
    let editAttempts = 0;
    const first = fakeInteraction({
      editReply: () => {
        editAttempts++;
        return editAttempts === 1
          ? Promise.reject(new Error("message edit failed"))
          : Promise.resolve(undefined);
      },
    });
    const outcome = await handleBucksAskPublish(first.interaction);
    expect(outcome).toBe("posted");
    expect(first.publicMessages).toHaveLength(1);

    const retry = fakeInteraction();
    await handleBucksAskPublish(retry.interaction);
    expect(retry.calls).toEqual(["reply"]);
    expect(retry.replies[0]?.content).toContain("already posted");
    expect(retry.publicMessages).toHaveLength(0);
  });

  test("leaves an idempotent retry after an ambiguous send", async () => {
    const delivered = new Map<string, BucksAskPublicMessage>();
    let attempts = 0;
    const sendPublic = async (message: BucksAskPublicMessage) => {
      delivered.set(message.nonce, message);
      attempts++;
      if (attempts === 1) {
        throw new Error("Discord accepted the send but the response was lost");
      }
      return message;
    };

    const first = fakeInteraction({ sendPublic });
    const outcome = await handleBucksAskPublish(first.interaction);

    expect(outcome).toBe("failed");
    expect(first.calls).toEqual(["deferUpdate", "sendPublic", "followUp"]);
    expect(first.edits).toEqual([]);
    expect(first.replies[0]?.content).toContain("retry safely");
    expect(delivered).toHaveLength(1);
    expect(delivered.get("ephemeral-answer-1")).toMatchObject({
      nonce: "ephemeral-answer-1",
      enforceNonce: true,
    });

    const retry = fakeInteraction({ sendPublic });
    expect(await handleBucksAskPublish(retry.interaction)).toBe("posted");
    expect(retry.calls).toEqual(["deferUpdate", "sendPublic", "editReply"]);
    expect(attempts).toBe(2);
    expect(delivered).toHaveLength(1);
  });
});

async function rejectMissingPermissions(): Promise<never> {
  throw Object.assign(new Error("Missing Permissions"), { code: 50_013 });
}

function fakeInteraction(
  options: {
    userId?: string;
    authorId?: string;
    sendPublic?: (message: BucksAskPublicMessage) => Promise<unknown>;
    editReply?: BucksAskPublishInteraction["editReply"];
  } = {},
) {
  const calls: string[] = [];
  const replies: Parameters<BucksAskPublishInteraction["followUp"]>[0][] = [];
  const edits: Parameters<BucksAskPublishInteraction["editReply"]>[0][] = [];
  const publicMessages: BucksAskPublicMessage[] = [];
  const sendPublic = options.sendPublic;
  const interaction: BucksAskPublishInteraction = {
    customId: formatBucksAskPublishCustomId({ askerDiscordId: ASKER }),
    user: { id: options.userId ?? ASKER },
    client: { user: { id: BOT_ID } },
    message: {
      id: "ephemeral-answer-1",
      author: { id: options.authorId ?? BOT_ID },
      embeds: [{ toJSON: () => EMBED }],
    },
    deferUpdate: mock(() => {
      calls.push("deferUpdate");
      return Promise.resolve(undefined);
    }),
    reply: mock((reply) => {
      calls.push("reply");
      replies.push(reply);
      return Promise.resolve(undefined);
    }),
    editReply: mock(async (edit) => {
      calls.push("editReply");
      edits.push(edit);
      return options.editReply === undefined
        ? await Promise.resolve(undefined)
        : await options.editReply(edit);
    }),
    followUp: mock((reply) => {
      calls.push("followUp");
      replies.push(reply);
      return Promise.resolve(undefined);
    }),
    sendPublic: mock(async (message) => {
      calls.push("sendPublic");
      const result =
        sendPublic === undefined
          ? await Promise.resolve(message)
          : await sendPublic(message);
      publicMessages.push(message);
      return result;
    }),
  };
  return { interaction, calls, replies, edits, publicMessages };
}
