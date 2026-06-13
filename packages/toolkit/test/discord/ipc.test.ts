import { describe, expect, test } from "bun:test";
import {
  DaemonStateSchema,
  MessageSchema,
  parseTtl,
  StatusResponseSchema,
} from "#lib/discord/ipc.ts";

describe("parseTtl", () => {
  test("parses bare seconds", () => {
    expect(parseTtl("90")).toBe(90);
  });

  test("parses s/m/h suffixes", () => {
    expect(parseTtl("45s")).toBe(45);
    expect(parseTtl("30m")).toBe(1800);
    expect(parseTtl("4h")).toBe(14_400);
  });

  test("rejects garbage", () => {
    expect(() => parseTtl("4 hours")).toThrow("Invalid TTL");
    expect(() => parseTtl("")).toThrow("Invalid TTL");
    expect(() => parseTtl("-5m")).toThrow("Invalid TTL");
  });
});

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
    };
    expect(MessageSchema.parse(message)).toEqual(message);
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
