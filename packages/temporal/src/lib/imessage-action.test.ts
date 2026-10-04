import { expect, test } from "vitest";
import { parseImessageAction } from "./imessage-action.ts";

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
  ["/help", { kind: "help" }],
  ["plain text", { kind: "continue", prompt: "plain text" }],
  ["/new invalid test", { kind: "help" }],
  ["/continue ../invalid test", { kind: "help" }],
  ["x".repeat(4001), { kind: "help" }],
  ["", { kind: "help" }],
])("normalizes iMessage commands: %s", (text, expected) => {
  expect(parseImessageAction(text)).toEqual(expected);
});
