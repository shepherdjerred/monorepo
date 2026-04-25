import { describe, test, expect } from "bun:test";
import type { UIMessage } from "ai";
import {
  sanitizeMessageForReplay,
  sanitizeMessagesForReplay,
} from "@shepherdjerred/birmel/voltagent/memory/sanitize.ts";

function makeAssistantMessage(parts: UIMessage["parts"]): UIMessage {
  return {
    id: "msg-test",
    role: "assistant",
    parts,
  };
}

describe("sanitizeMessageForReplay", () => {
  test("preserves text-only assistant messages unchanged", () => {
    const message = makeAssistantMessage([{ type: "text", text: "hello" }]);
    const sanitized = sanitizeMessageForReplay(message);
    expect(sanitized).toBe(message);
  });

  test("drops legacy reasoning parts that lack encryptedContent", () => {
    const message = makeAssistantMessage([
      {
        type: "reasoning",
        text: "thinking...",
        providerMetadata: { openai: { itemId: "rs_abc" } },
      },
      { type: "text", text: "answer" },
    ]);
    const sanitized = sanitizeMessageForReplay(message);
    expect(sanitized).not.toBe(message);
    expect(sanitized.parts).toHaveLength(1);
    expect(sanitized.parts[0]).toEqual({ type: "text", text: "answer" });
  });

  test("keeps reasoning parts that include reasoningEncryptedContent", () => {
    const message = makeAssistantMessage([
      {
        type: "reasoning",
        text: "thinking...",
        providerMetadata: {
          openai: {
            itemId: "rs_abc",
            reasoningEncryptedContent: "encrypted-blob-base64",
          },
        },
      },
      { type: "text", text: "answer" },
    ]);
    const sanitized = sanitizeMessageForReplay(message);
    expect(sanitized).toBe(message);
    expect(sanitized.parts).toHaveLength(2);
  });

  test("drops reasoning when encryptedContent is empty string", () => {
    const message = makeAssistantMessage([
      {
        type: "reasoning",
        text: "thinking...",
        providerMetadata: {
          openai: {
            itemId: "rs_abc",
            reasoningEncryptedContent: "",
          },
        },
      },
      { type: "text", text: "answer" },
    ]);
    const sanitized = sanitizeMessageForReplay(message);
    expect(sanitized.parts).toHaveLength(1);
  });

  test("drops reasoning when providerMetadata is missing entirely", () => {
    const message = makeAssistantMessage([
      { type: "reasoning", text: "thinking..." },
      { type: "text", text: "answer" },
    ]);
    const sanitized = sanitizeMessageForReplay(message);
    expect(sanitized.parts).toHaveLength(1);
  });

  test("preserves message when there are no parts", () => {
    const empty = makeAssistantMessage([]);
    expect(sanitizeMessageForReplay(empty)).toBe(empty);
  });

  test("does not touch non-reasoning parts that look similar", () => {
    const message = makeAssistantMessage([
      { type: "text", text: "this mentions reasoning but is text" },
    ]);
    expect(sanitizeMessageForReplay(message)).toBe(message);
  });
});

describe("sanitizeMessagesForReplay", () => {
  test("sanitizes each message in a conversation history", () => {
    const messages: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "what's up" }],
      },
      makeAssistantMessage([
        {
          type: "reasoning",
          text: "thinking...",
          providerMetadata: { openai: { itemId: "rs_legacy" } },
        },
        { type: "text", text: "not much" },
      ]),
      makeAssistantMessage([
        {
          type: "reasoning",
          text: "still thinking...",
          providerMetadata: {
            openai: {
              itemId: "rs_new",
              reasoningEncryptedContent: "encrypted-blob",
            },
          },
        },
        { type: "text", text: "ok" },
      ]),
    ];

    const sanitized = sanitizeMessagesForReplay(messages);
    expect(sanitized).toHaveLength(3);
    const [userMsg, legacyAssistant, newAssistant] = sanitized;
    if (userMsg == null || legacyAssistant == null || newAssistant == null) {
      throw new Error("expected three messages");
    }
    // user message untouched
    expect(userMsg).toBe(messages[0]!);
    // legacy assistant turn — reasoning dropped
    expect(legacyAssistant.parts).toHaveLength(1);
    expect(legacyAssistant.parts[0]).toEqual({
      type: "text",
      text: "not much",
    });
    // new assistant turn — reasoning preserved
    expect(newAssistant).toBe(messages[2]!);
    expect(newAssistant.parts).toHaveLength(2);
  });
});
