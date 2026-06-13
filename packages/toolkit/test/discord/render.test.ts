import { describe, expect, test } from "bun:test";
import type { IpcMessage } from "#lib/discord/ipc.ts";
import {
  renderMessages,
  renderStatus,
  renderVoiceStates,
} from "#lib/discord/render.ts";

const message: IpcMessage = {
  id: "100",
  channelId: "200",
  authorId: "300",
  authorTag: "bot#0",
  authorIsBot: true,
  content: "now playing",
  createdAt: "2026-06-12T01:02:03.000Z",
  embeds: [
    {
      title: "Now Playing",
      description: "Some Movie",
      fields: [{ name: "position", value: "00:01" }],
    },
  ],
  attachments: [],
};

describe("renderMessages", () => {
  test("includes author, bot marker, content, embed fields", () => {
    const output = renderMessages([message]);
    expect(output).toContain("**bot#0** [bot]");
    expect(output).toContain("now playing");
    expect(output).toContain("embed: **Now Playing**");
    expect(output).toContain("position: 00:01");
  });

  test("empty list", () => {
    expect(renderMessages([])).toBe("No messages.");
  });
});

describe("renderStatus", () => {
  test("shows identities and voice presence", () => {
    const output = renderStatus({
      pid: 42,
      startedAt: "2026-06-12T00:00:00.000Z",
      ttlSeconds: 14_400,
      idleSeconds: 7,
      identities: {
        bot: { id: "1", tag: "helper#0" },
        user: { id: "2", tag: "tester" },
      },
      voice: { guildId: "g", channelId: "c" },
    });
    expect(output).toContain("bot: helper#0 (1)");
    expect(output).toContain("userbot: tester (2)");
    expect(output).toContain("voice: in channel c (guild g)");
  });
});

describe("renderVoiceStates", () => {
  test("flags streaming users and skips disconnected ones", () => {
    const output = renderVoiceStates({
      states: [
        {
          userId: "1",
          userTag: "streamer",
          channelId: "vc",
          streaming: true,
          selfVideo: false,
          selfMute: true,
          selfDeaf: false,
        },
        {
          userId: "2",
          userTag: "gone",
          channelId: null,
          streaming: false,
          selfVideo: false,
          selfMute: false,
          selfDeaf: false,
        },
      ],
    });
    expect(output).toContain("streamer in vc [STREAMING, muted]");
    expect(output).not.toContain("gone");
  });

  test("empty voice", () => {
    expect(renderVoiceStates({ states: [] })).toBe("Nobody is in voice.");
  });
});
