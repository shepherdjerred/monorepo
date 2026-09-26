import { describe, expect, test } from "vitest";
import {
  BlueBubblesMessageSchema,
  blueBubblesCommand,
  parseImessageAction,
} from "./messages.ts";

const MESSAGE = {
  originalROWID: 1,
  guid: "message-guid",
  dateCreated: 1_750_000_000_000,
  isFromMe: false,
  text: "hello",
  handle: { address: "owner" },
  itemType: 0,
  associatedMessageType: null,
  chats: [{ guid: "iMessage;-;owner", style: 45 }],
};
describe("BlueBubbles message normalization", () => {
  test.each([
    [
      "/new claude investigate",
      { kind: "new", provider: "claude", prompt: "investigate" },
    ],
    [
      "/new codex investigate",
      { kind: "new", provider: "codex", prompt: "investigate" },
    ],
    [
      "/continue scheduled-chat more detail",
      { kind: "continue", chatId: "scheduled-chat", prompt: "more detail" },
    ],
    ["/use discord-chat", { kind: "use", chatId: "discord-chat" }],
    ["/chats", { kind: "list" }],
    ["plain text", { kind: "continue", prompt: "plain text" }],
    ["/new invalid test", { kind: "help" }],
    ["/continue ../invalid test", { kind: "help" }],
    ["x".repeat(4001), { kind: "help" }],
    ["", { kind: "help" }],
  ])("normalizes user commands: %s", (text, expected) => {
    expect(parseImessageAction(text)).toEqual(expected);
  });
  test("preserves stable identity, timestamp and binding", () => {
    expect(
      blueBubblesCommand(BlueBubblesMessageSchema.parse(MESSAGE), ["owner"]),
    ).toEqual({
      messageId: "message-guid",
      conversationId: "iMessage;-;owner",
      submittedAt: new Date(MESSAGE.dateCreated).toISOString(),
      sourceSequence: MESSAGE.originalROWID,
      action: { kind: "continue", prompt: "hello" },
    });
  });
  test.each([
    { isFromMe: true },
    { handle: { address: "stranger" } },
    { handle: null },
    { text: null },
    { text: " " },
    { itemType: 1 },
    { associatedMessageType: 2000 },
    { chats: [{ guid: "group-style-43", style: 43 }] },
    { chats: [] },
    { chats: [...MESSAGE.chats, ...MESSAGE.chats] },
  ])(
    "rejects echoes, unauthorized senders, reactions and groups: %j",
    (overrides) => {
      expect(
        blueBubblesCommand(
          BlueBubblesMessageSchema.parse({ ...MESSAGE, ...overrides }),
          ["owner"],
        ),
      ).toBeUndefined();
    },
  );
});
