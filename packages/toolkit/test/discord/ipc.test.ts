import { describe, expect, test } from "vitest";
import {
  DaemonStateSchema,
  MessageSchema,
  StatusResponseSchema,
} from "#lib/discord/ipc.ts";

describe("ipc schemas", () => {
  test("message round-trips", () => {
    const message = {
      id: "1",
      channelId: "2",
      authorId: "3",
      authorTag: "someone#0",
      authorIsBot: false,
      content: "hello",
      createdAt: "2026-06-12T00:00:00.000Z",
      embeds: [
        {
          title: null,
          description: "desc",
          fields: [{ name: "f", value: "v" }],
        },
      ],
      attachments: [{ name: "a.png", url: "https://example.com/a.png" }],
      mentionUserIds: ["4"],
      mentionRoleIds: ["5"],
      mentionsEveryone: false,
    };
    expect(MessageSchema.parse(message)).toEqual(message);
  });

  test("adds mention metadata omitted by an older running daemon", () => {
    const parsed = MessageSchema.parse({
      id: "1",
      channelId: "2",
      authorId: "3",
      authorTag: "someone#0",
      authorIsBot: false,
      content: "hello",
      createdAt: "2026-06-12T00:00:00.000Z",
      embeds: [],
      attachments: [],
    });

    expect(parsed.mentionUserIds).toEqual([]);
    expect(parsed.mentionRoleIds).toEqual([]);
    expect(parsed.mentionsEveryone).toBe(false);
  });

  test("status response requires voice to be present (nullable)", () => {
    const base = {
      pid: 1,
      startedAt: "2026-06-12T00:00:00.000Z",
      ttlSeconds: 60,
      idleSeconds: 0,
      identities: {},
    };
    expect(() => StatusResponseSchema.parse(base)).toThrow();
    expect(StatusResponseSchema.parse({ ...base, voice: null }).voice).toBe(
      null,
    );
  });

  test("daemon state rejects missing pid", () => {
    expect(() =>
      DaemonStateSchema.parse({
        startedAt: "2026-06-12T00:00:00.000Z",
        ttlSeconds: 60,
        identities: {},
      }),
    ).toThrow();
  });
});
