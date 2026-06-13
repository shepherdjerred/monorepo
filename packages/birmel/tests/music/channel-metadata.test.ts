import { describe, expect, test } from "bun:test";
import { getChannelMetadata } from "@shepherdjerred/birmel/music/channel-metadata.ts";

describe("getChannelMetadata", () => {
  test("keeps Discord channel send bound to the original metadata object", async () => {
    const sentMessages: string[] = [];
    const observedTargets: string[] = [];
    const metadata = {
      id: "text-channel-1",
      send(this: { id: string }, message: string): Promise<void> {
        observedTargets.push(this.id);
        sentMessages.push(message);
        return Promise.resolve();
      },
    };

    const channel = getChannelMetadata(metadata);
    if (channel?.send == null) {
      throw new Error("Expected metadata send function to be preserved");
    }

    await channel.send("hello");

    expect(channel.id).toBe("text-channel-1");
    expect(observedTargets).toEqual(["text-channel-1"]);
    expect(sentMessages).toEqual(["hello"]);
  });

  test("normalizes synchronous send functions to promises", async () => {
    const metadata = {
      send(message: string): string {
        return `sent ${message}`;
      },
    };

    const channel = getChannelMetadata(metadata);
    if (channel?.send == null) {
      throw new Error("Expected metadata send function to be preserved");
    }

    await expect(channel.send("message")).resolves.toBe("sent message");
  });
});
