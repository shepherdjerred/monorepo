import { describe, expect, test } from "vitest";
import { Client } from "discord.js";
import { z } from "zod";
import { handleSend } from "@shepherdjerred/birmel/agent-tools/tools/discord/actions/message-actions.ts";
import { toDiscordAttachments } from "@shepherdjerred/birmel/agent-tools/tools/staged-attachments.ts";

const CHANNEL_ID = "876543210987654321";

/**
 * Capture whatever `handleSend` hands to discord.js. The send path reads only
 * `client.channels.fetch`, then the channel's `type`, `isSendable()`,
 * `isTextBased()` and `send()`. Swapping the channel manager via `Reflect.set`
 * keeps this a real `Client` instead of a cast, so the test cannot drift from
 * the signature the production code actually takes.
 */
function makeClient(sent: unknown[]): Client {
  const channel = {
    type: 0,
    isSendable: () => true,
    isTextBased: () => true,
    send: (payload: unknown) => {
      sent.push(payload);
      return Promise.resolve({ id: "123456789012345678" });
    },
  };
  const client = new Client({ intents: [] });
  Reflect.set(client, "channels", {
    fetch: () => Promise.resolve(channel),
  });
  return client;
}

describe("toDiscordAttachments", () => {
  test("carries the name and description onto the attachment", () => {
    const [attachment] = toDiscordAttachments([
      {
        data: Buffer.from("png-bytes"),
        name: "birmel-1.png",
        description: "a cat",
      },
    ]);

    expect(attachment?.name).toBe("birmel-1.png");
    expect(attachment?.description).toBe("a cat");
  });

  test("truncates a description to the Discord limit", () => {
    const [attachment] = toDiscordAttachments([
      { data: Buffer.from("x"), name: "b.png", description: "z".repeat(2000) },
    ]);

    expect(attachment?.description).toHaveLength(1024);
  });

  test("omits the description when none was staged", () => {
    const [attachment] = toDiscordAttachments([
      { data: Buffer.from("x"), name: "b.png" },
    ]);

    expect(attachment?.description).toBeNull();
  });
});

describe("handleSend attachments", () => {
  test("sends plain content when nothing was staged", async () => {
    const sent: unknown[] = [];

    const result = await handleSend(makeClient(sent), CHANNEL_ID, "headlines");

    expect(result.success).toBe(true);
    expect(sent).toEqual(["headlines"]);
  });

  // A scheduled job that generated an image used to deliver the text only,
  // dropping an image that had already been produced and billed.
  test("sends staged attachments alongside the content", async () => {
    const sent: unknown[] = [];
    const files = toDiscordAttachments([
      { data: Buffer.from("png-bytes"), name: "birmel-1.png" },
    ]);

    const result = await handleSend(
      makeClient(sent),
      CHANNEL_ID,
      "here you go",
      { files },
    );

    expect(result.success).toBe(true);
    expect(sent).toHaveLength(1);
    const payload = z
      .object({ content: z.string(), files: z.array(z.unknown()) })
      .parse(sent[0]);
    expect(payload.content).toBe("here you go");
    expect(payload.files).toHaveLength(1);
  });
});
