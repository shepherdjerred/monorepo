import { describe, expect, test } from "vitest";
import { stormDiscordPost, type Send } from "./storm-discord.ts";

const env = {
  STORM_DISCORD_BOT_TOKEN: "test-token",
  STORM_DISCORD_CHANNEL_ID: "1558666120507162634",
};

const refuse: Send = () => Promise.resolve(new Response("{}", { status: 403 }));

describe("stormDiscordPost", () => {
  test("posts silently with mentions off and an enforced nonce", async () => {
    const calls: { url: string; body: string }[] = [];
    const send: Send = (url, init) => {
      calls.push({
        url,
        body: typeof init.body === "string" ? init.body : "",
      });
      return Promise.resolve(new Response("{}", { status: 200 }));
    };

    await stormDiscordPost(env, send)("hello", "rst-2027-01-01-week");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://discord.com/api/v10/channels/1558666120507162634/messages",
    );
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      content: "hello",
      nonce: "rst-2027-01-01-week",
      enforce_nonce: true,
      allowed_mentions: { parse: [] },
      flags: 4096,
    });
  });

  test("fails loudly on a refusal or missing credentials", async () => {
    let refusal: unknown;
    try {
      await stormDiscordPost(env, refuse)("hello", "n");
    } catch (error) {
      refusal = error;
    }
    expect(String(refusal)).toContain("HTTP 403");
    let missing: unknown;
    try {
      await stormDiscordPost({}, refuse)("hello", "n");
    } catch (error) {
      missing = error;
    }
    expect(missing).toBeDefined();
  });
});
